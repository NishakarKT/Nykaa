import React, { useRef, useEffect, useState } from "react";

const VirtualMakeupApp = () => {
  // Local and offscreen refs
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  // Two remote video refs & connection refs (for cyclic connections)
  const remoteVideoRef1 = useRef(null); // Slot A
  const remoteVideoRef2 = useRef(null); // Slot B
  const pcRef1 = useRef(null);
  const pcRef2 = useRef(null);

  // State
  const [isCameraOn, setIsCameraOn] = useState(false);
  // activeRemote: 1 means slot A is visible; 2 means slot B is visible.
  const [activeRemote, setActiveRemote] = useState(1);
  const [beautifiedFilter, setBeautifiedFilter] = useState(null);
  const [recommendedProducts, setRecommendedProducts] = useState({});
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

  // Makeup parameters (used by backend)
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
    BLUSH_RIGHT: "#DF5B6F"
  });
  const [blendIntensity, setBlendIntensity] = useState(0.2);

  // Refs to always hold the latest makeup settings.
  const makeupRef = useRef(selectedMakeup);
  const intensityRef = useRef(blendIntensity);
  useEffect(() => {
    makeupRef.current = selectedMakeup;
  }, [selectedMakeup]);
  useEffect(() => {
    intensityRef.current = blendIntensity;
  }, [blendIntensity]);

  // Fetch unique shades from backend.
  useEffect(() => {
    if (!isCameraOn) return;
    fetch("http://localhost:8000/unique_shades")
      .then((res) => res.json())
      .then((data) => {
        console.log("Unique shades received:", data);
        setUniqueColors({
          Lip: data.Lipstick || [],
          Eyebrow: data.Eyebrow || [],
          Eyeliner: data.Eyeliner || [],
          Eyeshadow: data.Eyeshadow || [],
          Blush: data.Blush || [],
          Foundation: data.Foundation || []
        });
        setSelectedMakeup((prev) => ({
          ...prev,
          LIP_UPPER: data.Lipstick && data.Lipstick.length > 0 ? data.Lipstick[0] : prev.LIP_UPPER,
          LIP_LOWER: data.Lipstick && data.Lipstick.length > 0 ? data.Lipstick[0] : prev.LIP_LOWER,
          EYEBROW_LEFT: data.Eyebrow && data.Eyebrow.length > 0 ? data.Eyebrow[0] : prev.EYEBROW_LEFT,
          EYEBROW_RIGHT: data.Eyebrow && data.Eyebrow.length > 0 ? data.Eyebrow[0] : prev.EYEBROW_RIGHT,
          EYELINER_LEFT: data.Eyeliner && data.Eyeliner.length > 0 ? data.Eyeliner[0] : prev.EYELINER_LEFT,
          EYELINER_RIGHT: data.Eyeliner && data.Eyeliner.length > 0 ? data.Eyeliner[0] : prev.EYELINER_RIGHT,
          EYESHADOW_LEFT: data.Eyeshadow && data.Eyeshadow.length > 0 ? data.Eyeshadow[0] : prev.EYESHADOW_LEFT,
          EYESHADOW_RIGHT: data.Eyeshadow && data.Eyeshadow.length > 0 ? data.Eyeshadow[0] : prev.EYESHADOW_RIGHT,
          BLUSH_LEFT: data.Blush && data.Blush.length > 0 ? data.Blush[0] : prev.BLUSH_LEFT,
          BLUSH_RIGHT: data.Blush && data.Blush.length > 0 ? data.Blush[0] : prev.BLUSH_RIGHT,
          FOUNDATION: data.Foundation && data.Foundation.length > 0 ? data.Foundation[0] : prev.FOUNDATION,
        }));
      })
      .catch((err) => console.error("Error fetching unique shades:", err));
  }, [isCameraOn]);

  // Updated initWebRTC: when a new data channel opens, send the current makeup parameters from refs.
  const initWebRTC = (stream, remoteRef, pcRef) => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });
    pcRef.current = pc;
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));
    const dc = pc.createDataChannel("makeup");
    dc.onopen = () => {
      console.log("Data channel open for", remoteRef === remoteVideoRef1 ? "Slot A" : "Slot B");
      const sendCurrent = () => {
        dc.send(JSON.stringify({ selectedMakeup: makeupRef.current, blendIntensity: intensityRef.current }));
      };
      sendCurrent();
      setTimeout(sendCurrent, 500);
      setTimeout(sendCurrent, 1000);
    };
    dc.onerror = (error) => console.error("Data channel error:", error);
    // Store the channel on pc so we can update it later if needed.
    pc.dataChannel = dc;
    pc.onicegatheringstatechange = () => console.log("ICE state:", pc.iceGatheringState);
    pc.ontrack = (event) => {
      if (event.track.kind === "video" && remoteRef.current) {
        remoteRef.current.srcObject = event.streams[0];
        // Clear any fallback image set earlier
        remoteRef.current.poster = "";
        console.log("Remote stream attached to", remoteRef === remoteVideoRef1 ? "Slot A" : "Slot B");
      }
    };
    pc.createOffer()
      .then((offer) => pc.setLocalDescription(offer))
      .then(() =>
        new Promise((resolve) => {
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
        })
      )
      .then(() =>
        fetch("http://localhost:8000/offer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sdp: pc.localDescription.sdp,
            type: pc.localDescription.type,
            makeup: { selectedMakeup: makeupRef.current, blendIntensity: intensityRef.current }
          })
        })
      )
      .then((res) => res.json())
      .then((answer) => pc.setRemoteDescription(answer))
      .catch((err) => console.error("WebRTC error:", err));
  };

  // New function to fetch product recommendations.
  const fetchProductRecommendations = () => {
    fetch("http://localhost:8000/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selectedMakeup })
    })
      .then((res) => res.json())
      .then((data) => {
        console.log(selectedMakeup);
        console.log("Product recommendations:", data);
        setRecommendedProducts(data.products || {});
      })
      .catch((err) => console.error("Product fetch error:", err));
  };

  // When makeup settings change, update both connections.
  useEffect(() => {
    const sendUpdate = (pc) => {
      if (pc && pc.dataChannel && pc.dataChannel.readyState === "open") {
        pc.dataChannel.send(JSON.stringify({ selectedMakeup: makeupRef.current, blendIntensity: intensityRef.current }));
      }
    };
    sendUpdate(pcRef1.current);
    sendUpdate(pcRef2.current);
  }, [selectedMakeup, blendIntensity]);

  // runCycle schedules reinitialization and swapping between slots.
  const runCycle = (stream, currentActive) => {
    if (currentActive === 1) {
      // Slot A is active; schedule reinit for slot B at T+10 sec.
      const prepareB = setTimeout(() => {
        if (pcRef2.current) {
          pcRef2.current.close();
          pcRef2.current = null;
        }
        initWebRTC(stream, remoteVideoRef2, pcRef2);
      }, 10000);
      // At T+15 sec, swap to slot B and close slot A.
      const swapToB = setTimeout(() => {
        // Capture fallback from slot A
        const fallback = captureFallbackFrame(remoteVideoRef1.current);
        if (remoteVideoRef2.current) {
          // Set fallback as poster (or use an overlay image)
          remoteVideoRef2.current.poster = fallback;
        }
        setActiveRemote(2);
        if (pcRef1.current) {
          pcRef1.current.close();
          pcRef1.current = null;
        }
        runCycle(stream, 2);
      }, 15000);
      return () => {
        clearTimeout(prepareB);
        clearTimeout(swapToB);
      };
    } else {
      // Slot B is active; schedule reinit for slot A at T+10 sec.
      const prepareA = setTimeout(() => {
        if (pcRef1.current) {
          pcRef1.current.close();
          pcRef1.current = null;
        }
        initWebRTC(stream, remoteVideoRef1, pcRef1);
      }, 10000);
      const swapToA = setTimeout(() => {
        const fallback = captureFallbackFrame(remoteVideoRef2.current);
        if (remoteVideoRef1.current) {
          remoteVideoRef1.current.poster = fallback;
        }
        setActiveRemote(1);
        if (pcRef2.current) {
          pcRef2.current.close();
          pcRef2.current = null;
        }
        runCycle(stream, 1);
      }, 15000);
      return () => {
        clearTimeout(prepareA);
        clearTimeout(swapToA);
      };
    }
  };

  useEffect(() => {
    if (!isCameraOn) return;
    // Use a temporary canvas to capture a frame and call the beautify API.
    navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 } }
    }).then((stream) => {
      // Create a temporary video element.
      const tempVideo = document.createElement("video");
      tempVideo.srcObject = stream;
      tempVideo.play();
      tempVideo.onloadeddata = () => {
        const tempCanvas = document.createElement("canvas");
        tempCanvas.width = tempVideo.videoWidth;
        tempCanvas.height = tempVideo.videoHeight;
        const ctx = tempCanvas.getContext("2d");
        ctx.drawImage(tempVideo, 0, 0, tempCanvas.width, tempCanvas.height);
        tempCanvas.toBlob((blob) => {
          if (blob) {
            const formData = new FormData();
            formData.append("file", blob, "capture.png");
            fetch("http://localhost:8000/beautify", {
              method: "POST",
              body: formData,
            })
              .then((res) => res.json())
              .then((data) => {
                console.log("Pre-fetched beautified filter:", data);
                if (data.filter) {
                  setBeautifiedFilter(data.filter);
                }
              })
              .catch((err) => console.error("Beautify fetch error:", err));
          }
        }, "image/png");
      };
    });
  }, [isCameraOn]);

  // Start camera and begin cyclic connection.
  useEffect(() => {
    let stopCycle;
    if (isCameraOn) {
      navigator.mediaDevices
        .getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 } }
        })
        .then((stream) => {
          // Set local preview.
          if (videoRef.current) videoRef.current.srcObject = stream;
          // Start with slot A only.
          initWebRTC(stream, remoteVideoRef1, pcRef1);
          setActiveRemote(1);
          // Begin the cycle.
          stopCycle = runCycle(stream, 1);
        })
        .catch((err) => console.error("Error accessing camera:", err));
    }
    return () => {
      if (stopCycle) stopCycle();
      if (pcRef1.current) {
        pcRef1.current.close();
        pcRef1.current = null;
      }
      if (pcRef2.current) {
        pcRef2.current.close();
        pcRef2.current = null;
      }
    };
  }, [isCameraOn]);

  const captureFallbackFrame = (video) => {
    if (!video || video.readyState < 4) return "";
    const fallbackCanvas = document.createElement("canvas");
    fallbackCanvas.width = video.videoWidth;
    fallbackCanvas.height = video.videoHeight;
    const ctx = fallbackCanvas.getContext("2d");
    ctx.drawImage(video, 0, 0, fallbackCanvas.width, fallbackCanvas.height);
    return fallbackCanvas.toDataURL("image/png");
  };

  // Capture frame from the active remote video and update processedImage.
  useEffect(() => {
    const captureInterval = setInterval(() => {
      const activeVideo = activeRemote === 1 ? remoteVideoRef1.current : remoteVideoRef2.current;
      const canvas = canvasRef.current;
      if (activeVideo && canvas && activeVideo.readyState === 4) {
        canvas.width = activeVideo.videoWidth;
        canvas.height = activeVideo.videoHeight;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(activeVideo, 0, 0, canvas.width, canvas.height);
      }
    }, 100);
    return () => clearInterval(captureInterval);
  }, [activeRemote]);

  const handleBeautify = () => {
    if (beautifiedFilter) {
      setSelectedMakeup((prev) => ({
        ...prev,
        LIP_UPPER: beautifiedFilter.Lipstick,
        LIP_LOWER: beautifiedFilter.Lipstick,
        EYELINER_LEFT: beautifiedFilter.Eyeliner,
        EYELINER_RIGHT: beautifiedFilter.Eyeliner,
        EYESHADOW_LEFT: beautifiedFilter.Eyeshadow,
        EYESHADOW_RIGHT: beautifiedFilter.Eyeshadow,
        BLUSH_LEFT: beautifiedFilter.Blush,
        BLUSH_RIGHT: beautifiedFilter.Blush,
        Foundation: beautifiedFilter.Foundation
      }));
    }
  };

  const handleCategoryColorSelect = (category, color) => {
    if (categoryMapping[category]) {
      setSelectedMakeup((prev) => {
        const updated = { ...prev };
        categoryMapping[category].forEach((key) => (updated[key] = color));
        return updated;
      });
    }
  };

  return (
    <div style={{ textAlign: "center", position: "relative" }}>
      <h1>Real-time Virtual Makeup App</h1>
      <div style={{ display: "flex", width: "100%" }}>
        {/* Local video container */}
        <div style={{ width: "50%" }}>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            style={{ width: "100%", height: "auto" }}
            hidden={!isCameraOn}
          />
        </div>

        {/* Remote videos container */}
        <div style={{ width: "50%", position: "relative" }}>
          <video
            ref={remoteVideoRef1}
            autoPlay
            playsInline
            style={{
              width: "100%",
              height: "auto",
              position: "absolute",
              top: 0,
              left: 0,
              zIndex: activeRemote === 1 ? 2 : 1,
              display: isCameraOn ? "block" : "none"
            }}
          />
          <video
            ref={remoteVideoRef2}
            autoPlay
            playsInline
            style={{
              width: "100%",
              height: "auto",
              position: "absolute",
              top: 0,
              left: 0,
              zIndex: activeRemote === 2 ? 2 : 1,
              display: isCameraOn ? "block" : "none"
            }}
          />
        </div>
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
      <div style={{ margin: "10px" }}>
        <button onClick={() => setIsCameraOn((prev) => !prev)}>
          {isCameraOn ? "Turn Off Camera" : "Turn On Camera"}
        </button>
      </div>
      <div style={{ margin: "10px" }}>
        <button onClick={handleBeautify}>Beautify</button>
      </div>
      <div style={{ margin: "10px" }}>
        <button onClick={fetchProductRecommendations}>
          Get Product recommendations
        </button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", margin: "10px" }}>
        <h3>Makeup Categories</h3>
        {["Lip", "Eyebrow", "Eyeliner", "Eyeshadow", "Blush", "Foundation"].map((category) => (
          <div key={category} style={{ display: "flex", alignItems: "center", margin: "5px", width: "90%" }}>
            <span style={{ width: "100px", textAlign: "right", marginRight: "10px" }}>{category}:</span>
            <div style={{ display: "flex", overflowX: "auto", padding: "0 10px" }}>
              {uniqueColors[category]?.map((color, index) => (
                <button
                  key={index}
                  onClick={() => handleCategoryColorSelect(category, color)}
                  style={{
                    minWidth: "40px",
                    minHeight: "40px",
                    width: "40px",
                    height: "40px",
                    borderRadius: "50%",
                    backgroundColor: color,
                    border: "2px solid #fff",
                    marginRight: "10px",
                    cursor: "pointer",
                    flex: "0 0 auto"
                  }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div>
        <h3>Recommendations</h3>
        {Object.keys(recommendedProducts).map((category) => (
          <div key={category} style={{ marginBottom: "20px" }}>
            <h3>{category}</h3>
            <div style={{ display: "flex", overflowX: "auto", padding: "0 10px" }}>
              {recommendedProducts[category].map((product) => (
                <div
                  key={product._id}
                  style={{
                    flex: "0 0 auto",
                    marginRight: "10px",
                    border: "1px solid #ccc",
                    borderRadius: "4px",
                    width: "200px",
                    padding: "10px",
                  }}
                >
                  <img
                    src={product.image_link || product.api_featured_image}
                    alt={product.name}
                    style={{ width: "100%", height: "auto" }}
                  />
                  <h4 style={{ fontSize: "16px", margin: "5px 0" }}>
                    {product.brand}
                  </h4>
                  <p style={{ margin: "5px 0" }}>{product.name}</p>
                  <p style={{ margin: "5px 0" }}>
                    {product.price_sign}
                    {product.price}
                  </p>
                  <a href={product.product_link} target="_blank" rel="noreferrer">
                    Buy Now
                  </a>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default VirtualMakeupApp;
