import asyncio
import json
import time
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from aiortc import RTCPeerConnection, RTCSessionDescription, MediaStreamTrack
from aiortc.contrib.media import VideoFrame, MediaRelay
import numpy as np
import cv2
from fastapi import File, UploadFile
from io import BytesIO
from PIL import Image
from skin import predict_skin_tone, generate_filters

from utils import read_landmarks, add_mask, face_points
from product_utils import get_unique_shades_by_product_type

from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Adjust for production use
    allow_methods=["*"],
    allow_headers=["*"],
)

relay = MediaRelay()
pcs = set()

def hex_to_bgr(hex_color: str):
    hex_color = hex_color.lstrip("#")
    return [int(hex_color[i:i+2], 16) for i in (4, 2, 0)]

def process_frame(img, makeup_params, intensity):
    try:
        landmarks = read_landmarks(img)
        if not landmarks or len(landmarks) == 0:
            return img
    except Exception as e:
        return img
    face_elements = ["FOUNDATION", "LIP_LOWER", "LIP_UPPER", "EYEBROW_LEFT", "EYEBROW_RIGHT", "EYELINER_LEFT", "EYELINER_RIGHT", "EYESHADOW_LEFT", "EYESHADOW_RIGHT", "BLUSH_LEFT", "BLUSH_RIGHT"]
    colors = [hex_to_bgr(makeup_params.get(element, "#000000")) for element in face_elements]
    connections = [face_points["FACE"] if element == "FOUNDATION" else face_points[element] for element in face_elements]
    mask = np.zeros_like(img)
    mask = add_mask(mask, idx_to_coordinates=landmarks, face_connections=connections, colors=colors)
    processed = cv2.addWeighted(img, 1.0, mask, intensity, 1)
    return processed

class LatestFrameTrack(MediaStreamTrack):
    kind = "video"
    def __init__(self, track, makeup_params, intensity_container):
        super().__init__()
        self.track = track
        self.makeup_params = makeup_params
        self.intensity = intensity_container
        self.latest = None
        asyncio.create_task(self._update())

    async def _update(self):
        while True:
            frame = await self.track.recv()
            # Overwrite with the most recent frame
            self.latest = frame

    async def recv(self):
        # Wait until a frame is available
        while self.latest is None:
            await asyncio.sleep(0.001)
        frame = self.latest
        # Optionally clear latest here if you want to force waiting for a new frame:
        self.latest = None
        # Process frame off-thread
        img = frame.to_ndarray(format="bgr24")
        processed = await asyncio.to_thread(process_frame, img, self.makeup_params, self.intensity["value"])
        new_frame = VideoFrame.from_ndarray(processed, format="bgr24")
        new_frame.pts = frame.pts
        new_frame.time_base = frame.time_base
        return new_frame

@app.post("/offer")
async def offer(request: Request):
    params = await request.json()
    offer = RTCSessionDescription(sdp=params["sdp"], type=params["type"])
    makeup = params.get("makeup", {})
    makeup_params = makeup.get("selectedMakeup", {
        "LIP_UPPER": "#AA0A1E",
        "LIP_LOWER": "#AA0A1E",
        "EYEBROW_LEFT": "#3B2F2F",
        "EYEBROW_RIGHT": "#3B2F2F",
        "EYELINER_LEFT": "#000000",
        "EYELINER_RIGHT": "#000000",
        "EYESHADOW_LEFT": "#660033",
        "EYESHADOW_RIGHT": "#660033",
        "BLUSH_LEFT": "#DF5B6F",
        "BLUSH_RIGHT": "#DF5B6F",
        "FOUNDATION": "#F1E7D5"
    })
    intensity = makeup.get("blendIntensity", 0.2)

    # Create mutable containers for dynamic updates.
    mutable_makeup_params = dict(makeup_params)
    intensity_container = {"value": intensity}

    pc = RTCPeerConnection()
    pcs.add(pc)
    pc._makeup_params = mutable_makeup_params
    pc._intensity = intensity_container

    @pc.on("datachannel")
    def on_datachannel(channel):
        @channel.on("message")
        def on_message(message):
            try:
                data = json.loads(message)
                if "selectedMakeup" in data:
                    pc._makeup_params.update(data["selectedMakeup"])
                if "blendIntensity" in data:
                    pc._intensity["value"] = data["blendIntensity"]
            except Exception as e:
                print("Error updating parameters:", e)

    @pc.on("track")
    def on_track(track):
        if track.kind == "video":
            latest_track = LatestFrameTrack(track, pc._makeup_params, pc._intensity)
            pc.addTrack(latest_track)

    await pc.setRemoteDescription(offer)
    answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    return JSONResponse({
        "sdp": pc.localDescription.sdp,
        "type": pc.localDescription.type,
    })

@app.post("/beautify")
async def beautify(file: UploadFile = File(...)):
    try:
        contents = await file.read()
        image = Image.open(BytesIO(contents))
        skin_tone = predict_skin_tone(image)
        filters = generate_filters(skin_tone, num_filters=1)
        return JSONResponse({"skin_tone": skin_tone, "filter": filters[0]})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=400)

@app.get("/unique_shades")
async def unique_shades():
    shades = get_unique_shades_by_product_type()
    return JSONResponse(shades)