import React, { useRef, useEffect, useState } from "react";

const VirtualMakeupApp = () => {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const remoteVideoRef = useRef(null); // hidden remote processed stream
  const beautifyCanvasRef = useRef(null);
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [processedImage, setProcessedImage] = useState(null);
  const [beautifyResults, setBeautifyResults] = useState(null);
  const [uniqueColors, setUniqueColors] = useState({
    Lip: [],
    Eyebrow: [],
    Eyeliner: [],
    Eyeshadow: [],
    Blush: [],
    Foundation: []
  });
  const categoryMapping = {
    Lip: ["LIP_UPPER", "LIP_LOWER"],
    Eyebrow: ["EYEBROW_LEFT", "EYEBROW_RIGHT"],
    Eyeliner: ["EYELINER_LEFT", "EYELINER_RIGHT"],
    Eyeshadow: ["EYESHADOW_LEFT", "EYESHADOW_RIGHT"],
    Blush: ["BLUSH_LEFT", "BLUSH_RIGHT"],
    Foundation: ["FOUNDATION"]
  };

  // Makeup parameters (used by the backend)
  const [selectedMakeup, setSelectedMakeup] = useState({
    LIP_UPPER: "#AA0A1E",
    LIP_LOWER: "#AA0A1E",
    EYEBROW_LEFT: "#3B2F2F",
    EYEBROW_RIGHT: "#3B2F2F",
    EYELINER_LEFT: "#000000",
    EYELINER_RIGHT: "#000000",
    EYESHADOW_LEFT: "#660033",
    EYESHADOW_RIGHT: "#660033",
    BLUSH_LEFT: "#DF5B6F",
    BLUSH_RIGHT: "#DF5B6F",
  });
  const [blendIntensity, setBlendIntensity] = useState(0.2);

  const pcRef = useRef(null);
  const dcRef = useRef(null);

  // Fetch the unique colors
  useEffect(() => {
    if (!isCameraOn) return;
    fetch("http://localhost:8000/unique_shades")
      .then((res) => res.json())
      .then((data) => {
        setUniqueColors({
          Lip: data.Lipstick || [],
          Eyebrow: data.Eyebrow || [],
          Eyeliner: data.Eyeliner || [],
          Eyeshadow: data.Eyeshadow || [],
          Blush: data.Blush || [],
          Foundation: data.Foundation || []
        });
      })
      .catch((err) => console.error("Error fetching unique shades:", err));
  }, [isCameraOn]);

  // Start camera and establish WebRTC connection
  useEffect(() => {
    let pc;
    if (isCameraOn) {
      console.log("Camera turned on. Requesting video stream...");
      navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } }
      }).then((stream) => {
        console.log("Local video stream acquired.");
        if (videoRef.current) videoRef.current.srcObject = stream;
        pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
        pcRef.current = pc;
        console.log("RTCPeerConnection created.");

        // Add local tracks
        stream.getTracks().forEach((track) => {
          console.log("Adding local track:", track.kind);
          pc.addTrack(track, stream);
        });

        // Create data channel to send makeup parameters
        const dc = pc.createDataChannel("makeup");
        dcRef.current = dc;
        dc.onopen = () => {
          console.log("Data channel open. Sending makeup parameters.");
          dc.send(JSON.stringify({ selectedMakeup, blendIntensity }));
        };
        dc.onerror = (error) => console.error("Data channel error:", error);

        // Debug ICE state changes
        pc.onicegatheringstatechange = () => {
          console.log("ICE gathering state changed:", pc.iceGatheringState);
        };

        // When remote processed video arrives, attach it to hidden video element
        pc.ontrack = (event) => {
          console.log("Track event received:", event.track.kind);
          if (event.track.kind === "video" && remoteVideoRef.current) {
            console.log("Attaching remote stream.");
            remoteVideoRef.current.srcObject = event.streams[0];
          }
        };

        // Create offer, send to backend, and set remote description
        pc.createOffer()
          .then((offer) => {
            console.log("Offer created:", offer);
            return pc.setLocalDescription(offer);
          })
          .then(() => {
            console.log("Local description set. Waiting for ICE gathering to complete...");
            return new Promise((resolve) => {
              if (pc.iceGatheringState === "complete") resolve();
              else {
                const checkState = () => {
                  if (pc.iceGatheringState === "complete") {
                    pc.removeEventListener("icegatheringstatechange", checkState);
                    resolve();
                  }
                };
                pc.addEventListener("icegatheringstatechange", checkState);
              }
            });
          })
          .then(() => {
            console.log("ICE gathering complete. Sending offer to backend.");
            return fetch("http://localhost:8000/offer", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                sdp: pc.localDescription.sdp,
                type: pc.localDescription.type,
                makeup: { selectedMakeup, blendIntensity }
              }),
            });
          })
          .then((res) => {
            console.log("Received response from backend.");
            return res.json();
          })
          .then((answer) => {
            console.log("Setting remote description with answer:", answer);
            return pc.setRemoteDescription(answer);
          })
          .catch((err) => console.error("WebRTC error:", err));
      })
        .catch((err) => console.error("Error accessing camera:", err));
    } else {
      console.log("Camera turned off. Closing connection.");
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }
    }
    return () => {
      console.log("Cleaning up connection.");
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }
    };
  }, [isCameraOn]);

  // Update makeup parameters via data channel when they change
  useEffect(() => {
    if (dcRef.current && dcRef.current.readyState === "open") {
      console.log("Updating makeup parameters via data channel.");
      dcRef.current.send(JSON.stringify({ selectedMakeup, blendIntensity }));
    }
  }, [selectedMakeup, blendIntensity]);

  // Capture frame from remote processed stream and update processedImage
  useEffect(() => {
    const captureInterval = setInterval(() => {
      const remoteVideo = remoteVideoRef.current;
      const canvas = canvasRef.current;
      if (remoteVideo && canvas) {
        if (remoteVideo.readyState === 4) {
          canvas.width = remoteVideo.videoWidth;
          canvas.height = remoteVideo.videoHeight;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(remoteVideo, 0, 0, canvas.width, canvas.height);
          canvas.toBlob((blob) => {
            if (blob) {
              console.log("Captured processed frame.");
              setProcessedImage(URL.createObjectURL(blob));
            }
          }, "image/png");
        }
      }
    }, 100);
    return () => clearInterval(captureInterval);
  }, [isCameraOn]);

  const handleMakeupChange = (param, value) => {
    console.log("Makeup parameter changed:", param, value);
    setSelectedMakeup((prev) => ({ ...prev, [param]: value }));
  };

  const applyFilter = (filter) => {
    setSelectedMakeup((prev) => ({
      ...prev,
      LIP_UPPER: filter.Lipstick,
      LIP_LOWER: filter.Lipstick,
      EYELINER_LEFT: filter.Eyeliner,
      EYELINER_RIGHT: filter.Eyeliner,
      EYESHADOW_LEFT: filter.Eyeshadow,
      EYESHADOW_RIGHT: filter.Eyeshadow,
      BLUSH_LEFT: filter.Blush,
      BLUSH_RIGHT: filter.Blush,
    }));
  };

  const handleBeautify = () => {
    if (!videoRef.current) return;
    const canvas = beautifyCanvasRef.current;
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (blob) {
        const formData = new FormData();
        formData.append("file", blob, "capture.png");
        fetch("http://localhost:8000/beautify", {
          method: "POST",
          body: formData,
        })
          .then((res) => res.json())
          .then((data) => {
            console.log("Beautify result:", data);
            setBeautifyResults(data);
          })
          .catch((err) => console.error("Beautify error:", err));
      }
    }, "image/png");
  };

  const handleCategoryColorSelect = (category, color) => {
    if (categoryMapping[category]) {
      setSelectedMakeup((prev) => {
        const updated = { ...prev };
        categoryMapping[category].forEach((key) => {
          updated[key] = color;
        });
        return updated;
      });
    }
  };

  const makeupOptions = [
    { label: "Lip Upper", param: "LIP_UPPER" },
    { label: "Lip Lower", param: "LIP_LOWER" },
    { label: "Left Eyebrow", param: "EYEBROW_LEFT" },
    { label: "Right Eyebrow", param: "EYEBROW_RIGHT" },
    { label: "Left Eyeliner", param: "EYELINER_LEFT" },
    { label: "Right Eyeliner", param: "EYELINER_RIGHT" },
    { label: "Left Eyeshadow", param: "EYESHADOW_LEFT" },
    { label: "Right Eyeshadow", param: "EYESHADOW_RIGHT" },
    { label: "Left Blush", param: "BLUSH_LEFT" },
    { label: "Right Blush", param: "BLUSH_RIGHT" },
    { label: "Foundation", param: "FOUNDATION" }
  ];

  return (
    <div style={{ textAlign: "center" }}>
      <h1>Real-time Virtual Makeup App</h1>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        style={{ width: "500px" }}
        hidden={!isCameraOn}
      />
      {/* Offscreen canvas for capturing frames */}
      <canvas ref={canvasRef} style={{ display: "none" }}></canvas>
      <canvas ref={beautifyCanvasRef} style={{ display: "none" }}></canvas>
      {/* Hidden video element to receive processed stream */}
      <video ref={remoteVideoRef} autoPlay playsInline style={{ display: "none" }} />
      <div style={{ margin: "10px" }}>
        <button onClick={() => setIsCameraOn((prev) => !prev)}>
          {isCameraOn ? "Turn Off Camera" : "Turn On Camera"}
        </button>
      </div>
      <div style={{ margin: "10px" }}>
        <button onClick={handleBeautify}>Beautify</button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", margin: "10px" }}>
        <h3>Makeup Categories</h3>
        {["Lip", "Eyebrow", "Eyeliner", "Eyeshadow", "Blush", "Foundation"].map((category) => (
          <div key={category} style={{ display: "flex", alignItems: "center", margin: "5px", width: "90%" }}>
            <span style={{ width: "100px", textAlign: "right", marginRight: "10px" }}>{category}:</span>
            {uniqueColors[category] ? (
              <div style={{ display: "flex", overflowX: "auto" }}>
                {uniqueColors[category].map((color, index) => (
                  <button
                    key={index}
                    onClick={() => handleCategoryColorSelect(category, color)}
                    style={{
                      width: "30px",
                      height: "30px",
                      borderRadius: "50%",
                      backgroundColor: color,
                      border: "2px solid #fff",
                      marginRight: "5px",
                      cursor: "pointer"
                    }}
                  />
                ))}
              </div>
            ) : (
              // For Eyebrow (or any category without API data) fall back to a color input
              <input
                type="color"
                onChange={(e) => handleCategoryColorSelect(category, e.target.value)}
                style={{ marginLeft: "10px" }}
              />
            )}
          </div>
        ))}
      </div>
      <div style={{ margin: "10px" }}>
        <label>
          Makeup Intensity:
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={blendIntensity}
            onChange={(e) => setBlendIntensity(parseFloat(e.target.value))}
            style={{ marginLeft: "10px" }}
          />
          {blendIntensity}
        </label>
      </div>
      {processedImage && (
        <div style={{ marginTop: "20px" }}>
          <h2>Processed Image</h2>
          <img
            src={processedImage}
            alt="Processed Makeup"
            style={{ width: "500px", border: "1px solid #ccc" }}
          />
        </div>
      )}
      <div>Beautification</div>
      {beautifyResults && (
        <div style={{ marginTop: "20px" }}>
          <h2>Beautify Results</h2>
          <div>
            {beautifyResults.filters.map((filter, index) => (
              <button
                key={index}
                onClick={() => applyFilter(filter)}
                style={{
                  margin: "5px",
                  padding: "10px",
                  backgroundColor: filter.Lipstick,
                  color: "#fff",
                  border: "none",
                  borderRadius: "4px",
                  cursor: "pointer",
                }}
              >
                Filter {index + 1}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default VirtualMakeupApp;
