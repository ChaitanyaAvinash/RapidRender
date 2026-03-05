import React, { useState, useEffect, useRef } from 'react';
import { Rnd } from 'react-rnd';
import { SelfieSegmentation } from '@mediapipe/selfie_segmentation';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';

function App() {
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState("Waiting for speech...");
  const [partialTranscript, setPartialTranscript] = useState("");
  const [socket, setSocket] = useState(null);
  
  const [mediaRecorder, setMediaRecorder] = useState(null);
  const [audioStream, setAudioStream] = useState(null);
  const [videoRecorder, setVideoRecorder] = useState(null); 
  
  const [activeAsset, setActiveAsset] = useState(null);   
  const [loadingAsset, setLoadingAsset] = useState(null); 
  const [isHighResReady, setIsHighResReady] = useState(false); 
  const [imageQueue, setImageQueue] = useState([]);
  const [isProcessingQueue, setIsProcessingQueue] = useState(false);
  
  const [warmupCount, setWarmupCount] = useState(0);
  const WARMUP_THRESHOLD = 2; 
  
  const [highlights, setHighlights] = useState("");
  const [description, setDescription] = useState("");

  const [displayMode, setDisplayModeState] = useState("pip"); 
  
  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return true;
  });

  const [showInstructions, setShowInstructions] = useState(false);

  const [recordedWebmBlob, setRecordedWebmBlob] = useState(null);
  const [isRendering, setIsRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const [exportFormat, setExportFormat] = useState('16:9'); 
  const [exportQuality, setExportQuality] = useState('720p'); 
  const ffmpegRef = useRef(new FFmpeg());

  const canvasRef = useRef(null);
  const hiddenVideoRef = useRef(null);
  const activeImgRef = useRef(null);
  const highResImgRef = useRef(null); 
  const animationRef = useRef(null);

  const pipRef = useRef({ x: 30, y: 30, width: 320, height: 180 });
  const weathermanRef = useRef({ x: 30, y: 30, width: 640, height: 360 });

  const displayModeRef = useRef("pip");
  const activeAssetRef = useRef(null);
  const isHighResReadyRef = useRef(false);

  useEffect(() => { displayModeRef.current = displayMode; }, [displayMode]);
  useEffect(() => { activeAssetRef.current = activeAsset; }, [activeAsset]);
  useEffect(() => { isHighResReadyRef.current = isHighResReady; }, [isHighResReady]);

  useEffect(() => {
    const hasSeenIntro = localStorage.getItem('rapidRender_hasSeenIntro');
    if (!hasSeenIntro) {
      setShowInstructions(true);
    }
  }, []);

  const closeInstructions = () => {
    setShowInstructions(false);
    localStorage.setItem('rapidRender_hasSeenIntro', 'true');
  };

  useEffect(() => {
    const screenWidth = window.innerWidth;
    const stageWidth = Math.min(screenWidth - 600, 1100); 
    const stageHeight = stageWidth * (9 / 16); 
    const safeBottomY = stageHeight - 180 - 30; 
    const safeWeatherY = stageHeight - 360 - 30;
    
    pipRef.current.y = safeBottomY > 10 ? safeBottomY : 30;
    weathermanRef.current.y = safeWeatherY > 10 ? safeWeatherY : 30;
    pipRef.current.x = 30;
    weathermanRef.current.x = 30;
  }, []);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || showInstructions) return;
      if (e.key === '1') setDisplayModeState('pip');
      if (e.key === '2') setDisplayModeState('weatherman');
      if (e.key === 'Escape') handleClearAsset();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showInstructions]); 

  useEffect(() => {
    const getMedia = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: true });
        setAudioStream(stream);
        if (hiddenVideoRef.current) hiddenVideoRef.current.srcObject = stream;
      } catch (err) { console.error("Error:", err); }
    };
    getMedia();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const video = hiddenVideoRef.current;

    if (!ctx || !canvas || !video) return;

    const segmenter = new SelfieSegmentation({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`
    });
    segmenter.setOptions({ modelSelection: 1 });

    segmenter.onResults((results) => {
      if (displayModeRef.current !== 'weatherman') return;

      const activeImg = activeImgRef.current;       
      const highResImg = highResImgRef.current;     
      const asset = activeAssetRef.current;
      const isReady = isHighResReadyRef.current;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (asset) {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const { x, y, width, height } = weathermanRef.current;
        const cx = x * scaleX;
        const cy = y * scaleY;
        const cw = width * scaleX;
        const ch = height * scaleY;

        ctx.save();
        ctx.translate(cx + cw, cy); 
        ctx.scale(-1, 1);
        ctx.drawImage(results.image, 0, 0, cw, ch);

        ctx.globalCompositeOperation = 'destination-in';
        ctx.drawImage(results.segmentationMask, 0, 0, cw, ch);
        ctx.restore(); 

        ctx.save();
        ctx.globalCompositeOperation = 'destination-over';
        const imgToDraw = (isReady && highResImg && highResImg.complete && highResImg.naturalWidth > 0) ? highResImg : activeImg;
        
        if (imgToDraw && imgToDraw.complete && imgToDraw.naturalWidth > 0) {
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(imgToDraw, 0, 0, canvas.width, canvas.height);
        } else {
          ctx.fillStyle = '#000';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        ctx.restore();
      } else {
        ctx.save();
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
        ctx.restore();
      }
    });

    let lastTime = 0;
    const fpsInterval = 1000 / 30; 
    let isProcessingAI = false; 

    const drawFrame = async (time) => {
      animationRef.current = requestAnimationFrame(drawFrame);
      if (time - lastTime < fpsInterval) return; 
      lastTime = time;

      if (video.readyState >= 2 && video.videoWidth > 0) {
        if (displayModeRef.current === 'weatherman') {
          if (!isProcessingAI) {
            isProcessingAI = true;
            try { await segmenter.send({ image: video }); } catch (err) {}
            isProcessingAI = false; 
          }
        } else {
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.globalCompositeOperation = 'source-over';
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          const asset = activeAssetRef.current;

          if (asset) {
            const activeImg = activeImgRef.current;       
            const highResImg = highResImgRef.current;     
            const isReady = isHighResReadyRef.current;
            const imgToDraw = (isReady && highResImg && highResImg.complete && highResImg.naturalWidth > 0) ? highResImg : activeImg;

            if (imgToDraw && imgToDraw.complete && imgToDraw.naturalWidth > 0) {
              ctx.imageSmoothingEnabled = true;
              ctx.imageSmoothingQuality = 'high';
              ctx.drawImage(imgToDraw, 0, 0, canvas.width, canvas.height);
            } else {
              ctx.fillStyle = '#000';
              ctx.fillRect(0, 0, canvas.width, canvas.height);
            }

            const rect = canvas.getBoundingClientRect();
            const scaleX = canvas.width / rect.width;
            const scaleY = canvas.height / rect.height;
            const { x, y, width, height } = pipRef.current;
            const cx = x * scaleX;
            const cy = y * scaleY;
            const cw = width * scaleX;
            const ch = height * scaleY;

            ctx.save();
            ctx.translate(cx + cw, cy);
            ctx.scale(-1, 1);
            ctx.beginPath();
            if (ctx.roundRect) { ctx.roundRect(0, 0, cw, ch, 24); } else { ctx.rect(0, 0, cw, ch); }
            ctx.clip(); 

            const zoom = 1.3; 
            const zWidth = cw * zoom;
            const zHeight = ch * zoom;
            const offsetX = -(zWidth - cw) / 2;    
            const offsetY = -(zHeight - ch) * 0.2; 
            ctx.drawImage(video, offsetX, offsetY, zWidth, zHeight);
            
            ctx.lineWidth = 6;
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)'; 
            ctx.stroke();
            ctx.restore();
          } else {
            ctx.save();
            ctx.translate(canvas.width, 0);
            ctx.scale(-1, 1);
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            ctx.restore();
          }
        }
      }
    };
    animationRef.current = requestAnimationFrame(drawFrame);
    return () => { cancelAnimationFrame(animationRef.current); segmenter.close(); };
  }, [audioStream]); 

  const toggleRecording = () => {
    if (!isRecording) {
      setTranscript("Waiting for speech...");
      setPartialTranscript("");
      handleClearAsset(); 
      setRecordedWebmBlob(null);
      setRenderProgress(0);

      if (canvasRef.current && audioStream) {
        try {
          const canvasStream = canvasRef.current.captureStream(30);
          const combinedStream = new MediaStream([...canvasStream.getVideoTracks(), ...audioStream.getAudioTracks()]);
          
          // Request VP8 codec for FFmpeg compatibility
          const options = MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus') 
                        ? { mimeType: 'video/webm;codecs=vp8,opus' } 
                        : { mimeType: 'video/webm' };
          
          const recorder = new MediaRecorder(combinedStream, options);
          const localChunks = [];

          recorder.ondataavailable = (e) => { if (e.data.size > 0) localChunks.push(e.data); };
          recorder.onstop = () => {
            const blob = new Blob(localChunks, { type: 'video/webm' });
            setRecordedWebmBlob(blob);
          };
          recorder.start(1000); 
          setVideoRecorder(recorder);
        } catch (err) {}
      }

      const wsUrl = `wss://rapidrender-backend.onrender.com/ws/audio?highlights=${encodeURIComponent(highlights)}&description=${encodeURIComponent(description)}`;
      const ws = new WebSocket(wsUrl);
      ws.onopen = () => {
        if (audioStream) {
          const audioTrack = audioStream.getAudioTracks()[0];
          const audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
          const source = audioContext.createMediaStreamSource(new MediaStream([audioTrack]));
          const processor = audioContext.createScriptProcessor(4096, 1, 1);
          source.connect(processor);
          processor.connect(audioContext.destination);
          processor.onaudioprocess = (e) => {
            if (ws.readyState === WebSocket.OPEN) {
              const float32Array = e.inputBuffer.getChannelData(0);
              const int16Array = new Int16Array(float32Array.length);
              for (let i = 0; i < float32Array.length; i++) {
                let s = Math.max(-1, Math.min(1, float32Array[i]));
                int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
              }
              ws.send(int16Array.buffer);
            }
          };
          setMediaRecorder({ audioContext, processor, source });
        }
      };

      ws.onmessage = (event) => {
        const response = JSON.parse(event.data);
        if (response.partial_transcript !== undefined) setPartialTranscript(response.partial_transcript);
        if (response.transcript) {
          setPartialTranscript(""); 
          setTranscript(prev => prev === "Waiting for speech..." ? response.transcript : prev + " " + response.transcript);
        }
        if (response.action === "new_asset") {
          setImageQueue(prev => [...prev, { thumb_url: response.thumb_url, high_res_url: response.high_res_url, type: response.type }]);
        }
      };
      setSocket(ws);
      setIsRecording(true);
    } else {
      if (videoRecorder && videoRecorder.state !== 'inactive') videoRecorder.stop();
      if (mediaRecorder) {
        mediaRecorder.source.disconnect();
        mediaRecorder.processor.disconnect();
        if (mediaRecorder.audioContext.state !== 'closed') mediaRecorder.audioContext.close();
        setMediaRecorder(null);
      }
      if (socket) socket.close();
      setIsRecording(false);
      setWarmupCount(0);
    }
  };

  const handleExport = async () => {
    if (!recordedWebmBlob) return;
    setIsRendering(true);
    setRenderProgress(5); 

    const progressInterval = setInterval(() => {
      setRenderProgress((prev) => {
        const increment = prev < 50 ? 8 : (prev < 80 ? 3 : 1);
        return Math.min(prev + increment, 90); 
      });
    }, 600);

    try {
      const ffmpeg = ffmpegRef.current;
      if (!ffmpeg.loaded) {
        await ffmpeg.load({
          coreURL: 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.js',
          wasmURL: 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.wasm',
        });
      }

      await ffmpeg.writeFile('input.webm', await fetchFile(recordedWebmBlob));

      // Math for Even Pixels and Aspect Ratio Scaling
      let crop = '';
      let scale = '';

      if (exportFormat === '16:9') {
        scale = exportQuality === '1080p' ? '1920:1080' : '1280:720';
      } else if (exportFormat === '9:16') {
        // Must be even numbers to prevent yuv420p crash
        crop = 'crop=404:720'; 
        scale = exportQuality === '1080p' ? '1080:1920' : '720:1280';
      } else if (exportFormat === '1:1') {
        crop = 'crop=720:720';
        scale = exportQuality === '1080p' ? '1080:1080' : '720:720';
      }

      const filterChain = crop ? `${crop},scale=${scale}` : `scale=${scale}`;

      // 30fps and universal yuv420p color format
      await ffmpeg.exec([
        '-i', 'input.webm', 
        '-vf', filterChain, 
        '-r', '30',
        '-c:v', 'libx264', 
        '-preset', 'ultrafast', 
        '-crf', '22', 
        '-pix_fmt', 'yuv420p', 
        '-c:a', 'aac', 
        'output.mp4'
      ]);
      
      clearInterval(progressInterval);
      setRenderProgress(100);

      const data = await ffmpeg.readFile('output.mp4');
      const url = URL.createObjectURL(new Blob([data.buffer], { type: 'video/mp4' }));
      
      setTimeout(() => {
        const a = document.createElement('a');
        a.href = url;
        a.download = `RapidRender_${exportFormat.replace(':','x')}_${exportQuality}.mp4`;
        a.click();
        
        setIsRendering(false);
        setRenderProgress(0);
        setRecordedWebmBlob(null);
      }, 600);

    } catch (error) {
      console.error("FFmpeg Render Failed:", error);
      clearInterval(progressInterval);
      setIsRendering(false);
      alert("Render failed. Please ensure you record for at least 3 seconds.");
    }
  };

  useEffect(() => {
    if (imageQueue.length > 0 && !isProcessingQueue) {
      setIsProcessingQueue(true);
      setLoadingAsset(imageQueue[0]); 
    }
  }, [imageQueue, isProcessingQueue]);

  const handleImageLoad = () => {
    const currentlyWarm = warmupCount >= WARMUP_THRESHOLD;
    setActiveAsset({ ...loadingAsset, isAlreadyHighRes: currentlyWarm }); 
    setIsHighResReady(currentlyWarm); 
    setWarmupCount(prev => prev + 1);
    setTimeout(() => { setImageQueue(prev => prev.slice(1)); setIsProcessingQueue(false); }, 3000);
  };

  const handleHighResLoad = () => { setIsHighResReady(true); };
  const handleImageError = () => { setImageQueue(prev => prev.slice(1)); setIsProcessingQueue(false); };
  const handleClearAsset = () => {
    setActiveAsset(null); setLoadingAsset(null); setIsHighResReady(false); setImageQueue([]); setIsProcessingQueue(false); setWarmupCount(0);
  };

  const theme = isDarkMode ? {
    panelBg: 'rgba(30, 32, 38, 0.75)', 
    border: 'rgba(255, 255, 255, 0.1)', 
    text: '#f1f5f9', 
    subtext: '#94a3b8', 
    inputBg: 'rgba(15, 17, 21, 0.6)', 
    shadow: '0 8px 32px 0 rgba(0, 0, 0, 0.3)',
    accent: '#38bdf8', 
    record: '#fb7185', 
  } : {
    panelBg: 'rgba(255, 255, 255, 0.85)', 
    border: 'rgba(203, 213, 225, 0.6)', 
    text: '#0f172a', 
    subtext: '#475569', 
    inputBg: 'rgba(241, 245, 249, 0.8)', 
    shadow: '0 8px 32px 0 rgba(148, 163, 184, 0.2)',
    accent: '#0284c7', 
    record: '#e11d48', 
  };

  return (
    <>
      <style>{`
        @keyframes modalFadeIn { from { opacity: 0; transform: translateY(20px) scale(0.95); } to { opacity: 1; transform: translateY(0) scale(1); } }
        
        .main-container { display: flex; height: 100vh; width: 100vw; margin: -8px; overflow: hidden; font-family: 'Inter', -apple-system, sans-serif; transition: all 0.5s ease; background-size: 200% 200%; }
        
        .main-container.dark { background: linear-gradient(-45deg, #0f172a, #1e1b4b, #172554, #0f172a); animation: bgAnim 15s ease infinite; }
        .main-container.light { background: linear-gradient(-45deg, #e0e7ff, #fae8ff, #dbeafe, #e0e7ff); animation: bgAnim 15s ease infinite; }
        @keyframes bgAnim { 0% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } 100% { background-position: 0% 50%; } }

        .glass-panel { backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); transition: all 0.3s ease; }
        .btn-hover { transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1); }
        .btn-hover:hover { transform: translateY(-2px); filter: brightness(1.1); }
        .btn-hover:active { transform: translateY(1px); }
        .input-glass:focus { outline: 2px solid ${theme.accent}; background: ${isDarkMode ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.9)'}; }
        
        .gradient-title { -webkit-background-clip: text !important; background-clip: text !important; -webkit-text-fill-color: transparent !important; color: transparent !important; display: inline-block; }
        .gradient-title.dark { background: linear-gradient(45deg, #38bdf8, #c084fc); }
        .gradient-title.light { background: linear-gradient(45deg, #0284c7, #9333ea); }
        
        .modal-overlay { position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; z-index: 9999; }
        .instruction-box { background: ${theme.panelBg}; border: 1px solid ${theme.border}; padding: 40px; border-radius: 20px; max-width: 500px; width: 90%; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); color: ${theme.text}; animation: modalFadeIn 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
        .instruction-step { display: flex; align-items: flex-start; gap: 15px; margin-bottom: 20px; }
        .step-icon { font-size: 20px; background: ${theme.inputBg}; width: 40px; height: 40px; border-radius: 10px; display: flex; align-items: center; justify-content: center; border: 1px solid ${theme.border}; }
      `}</style>

      <div className={`main-container ${isDarkMode ? 'dark' : 'light'}`} style={{ color: theme.text }}>
        
        {/* LEFT PANEL */}
        <div className="glass-panel" style={{ width: '320px', backgroundColor: theme.panelBg, borderRight: `1px solid ${theme.border}`, display: 'flex', flexDirection: 'column', padding: '25px', boxSizing: 'border-box', zIndex: 10, boxShadow: theme.shadow, overflowY: 'auto' }}>
          
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '25px' }}>
            <div>
              <h1 className={`gradient-title ${isDarkMode ? 'dark' : 'light'}`} style={{ margin: '0 0 6px 0', fontSize: '26px', fontWeight: '900' }}>RapidRender</h1>
              <p style={{ margin: 0, fontSize: '11px', color: theme.subtext, fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.8px', lineHeight: '1.4' }}>A LiveDirector AI <br/> By Team Luminare</p>
            </div>
            
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="btn-hover" onClick={() => setShowInstructions(true)} title="How to use" style={{ background: theme.inputBg, border: `1px solid ${theme.border}`, borderRadius: '50%', width: '36px', height: '36px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px', color: theme.text }}>?</button>
              <button className="btn-hover" onClick={() => setIsDarkMode(!isDarkMode)} style={{ background: theme.inputBg, border: `1px solid ${theme.border}`, borderRadius: '50%', width: '36px', height: '36px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', color: theme.text }}>{isDarkMode ? '☀️' : '🌙'}</button>
            </div>
          </div>

          <label style={{ fontSize: '12px', fontWeight: '700', marginBottom: '8px', letterSpacing: '0.5px', color: theme.subtext }}>MAIN HIGHLIGHTS</label>
          <input className="input-glass" type="text" value={highlights} onChange={(e) => setHighlights(e.target.value)} disabled={isRecording} placeholder="e.g. Space, Tech, Mars..." style={{ padding: '14px', backgroundColor: theme.inputBg, color: theme.text, border: `1px solid ${theme.border}`, borderRadius: '10px', marginBottom: '20px', width: '100%', boxSizing: 'border-box', transition: 'all 0.2s', fontSize: '14px' }} />

          <label style={{ fontSize: '12px', fontWeight: '700', marginBottom: '8px', letterSpacing: '0.5px', color: theme.subtext }}>VIDEO DESCRIPTION</label>
          <textarea className="input-glass" value={description} onChange={(e) => setDescription(e.target.value)} disabled={isRecording} placeholder="Describe the vibe of the video..." style={{ padding: '14px', backgroundColor: theme.inputBg, color: theme.text, border: `1px solid ${theme.border}`, borderRadius: '10px', minHeight: '120px', resize: 'none', width: '100%', boxSizing: 'border-box', marginBottom: '25px', transition: 'all 0.2s', fontSize: '14px', fontFamily: 'inherit' }} />

          <label style={{ fontSize: '12px', fontWeight: '700', marginBottom: '8px', letterSpacing: '0.5px', color: theme.subtext }}>DISPLAY MODE</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '25px' }}>
            <button className="btn-hover" onClick={() => setDisplayModeState('pip')} style={{ width: '100%', padding: '20px 15px', borderRadius: '12px', border: displayMode === 'pip' ? `2px solid ${theme.accent}` : `1px solid ${theme.border}`, backgroundColor: displayMode === 'pip' ? (isDarkMode ? 'rgba(56, 189, 248, 0.15)' : 'rgba(2, 132, 199, 0.1)') : theme.inputBg, color: theme.text, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '18px' }}>
              <div style={{ width: '48px', height: '32px', backgroundColor: isDarkMode ? '#334155' : '#cbd5e1', borderRadius: '4px', position: 'relative', border: `1px solid ${theme.border}` }}><div style={{ position: 'absolute', bottom: '4px', left: '4px', width: '30%', height: '40%', backgroundColor: displayMode === 'pip' ? theme.accent : theme.subtext, borderRadius: '2px' }}></div></div>
              <span style={{ fontSize: '15px', fontWeight: '700' }}>Picture-in-Picture</span>
            </button>
            <button className="btn-hover" onClick={() => setDisplayModeState('weatherman')} style={{ width: '100%', padding: '20px 15px', borderRadius: '12px', border: displayMode === 'weatherman' ? `2px solid ${theme.accent}` : `1px solid ${theme.border}`, backgroundColor: displayMode === 'weatherman' ? (isDarkMode ? 'rgba(56, 189, 248, 0.15)' : 'rgba(2, 132, 199, 0.1)') : theme.inputBg, color: theme.text, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '18px' }}>
              <div style={{ width: '48px', height: '32px', backgroundColor: isDarkMode ? '#334155' : '#cbd5e1', borderRadius: '4px', position: 'relative', border: `1px solid ${theme.border}`, display: 'flex', justifyContent: 'center', alignItems: 'flex-end', overflow: 'hidden' }}><div style={{ width: '40%', height: '70%', backgroundColor: displayMode === 'weatherman' ? theme.accent : theme.subtext, borderRadius: '50% 50% 0 0' }}></div></div>
              <span style={{ fontSize: '15px', fontWeight: '700' }}>Weatherman AR</span>
            </button>
          </div>

          <label style={{ fontSize: '12px', fontWeight: '700', marginBottom: '8px', letterSpacing: '0.5px', color: theme.subtext }}>TARGET FRAME (SAFE ZONE)</label>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
            {[
              { ratio: '16:9', w: 24, h: 14 },
              { ratio: '9:16', w: 14, h: 24 },
              { ratio: '1:1',  w: 18, h: 18 }
            ].map(r => (
              <button key={r.ratio} className="btn-hover" onClick={() => setExportFormat(r.ratio)} disabled={isRecording} style={{ flex: 1, padding: '15px 5px', borderRadius: '12px', border: exportFormat === r.ratio ? `2px solid ${theme.accent}` : `1px solid ${theme.border}`, background: exportFormat === r.ratio ? (isDarkMode ? 'rgba(56, 189, 248, 0.15)' : 'rgba(2, 132, 199, 0.1)') : theme.inputBg, color: theme.text, cursor: isRecording ? 'not-allowed' : 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', opacity: isRecording && exportFormat !== r.ratio ? 0.3 : 1 }}>
                <div style={{ width: `${r.w}px`, height: `${r.h}px`, border: `2px solid ${exportFormat === r.ratio ? theme.accent : theme.subtext}`, borderRadius: '3px' }}></div>
                <span style={{ fontWeight: 'bold', fontSize: '13px' }}>{r.ratio}</span>
              </button>
            ))}
          </div>

          <div style={{ flex: 1 }}></div>

          <button className="btn-hover" onClick={toggleRecording} style={{ padding: '16px', fontSize: '16px', fontWeight: 'bold', border: 'none', borderRadius: '12px', cursor: 'pointer', backgroundColor: isRecording ? theme.record : theme.accent, color: isDarkMode && !isRecording ? '#000' : 'white', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', boxShadow: `0 4px 15px ${isRecording ? 'rgba(225, 29, 72, 0.3)' : 'rgba(0,0,0,0.2)'}` }}>
            <span style={{ display: 'inline-block', width: '12px', height: '12px', backgroundColor: isDarkMode && !isRecording ? '#000' : 'white', borderRadius: isRecording ? '2px' : '50%', transition: 'all 0.2s' }}></span>
            {isRecording ? 'Stop Recording' : 'Start Recording'}
          </button>
        </div>

        {/* MIDDLE PANEL */}
        <div style={{ flex: 1, padding: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
          <div style={{ position: 'relative', width: '100%', maxWidth: '1100px', aspectRatio: '16/9', backgroundColor: '#000', borderRadius: '16px', overflow: 'hidden', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255,255,255,0.1)' }}>
            
            <canvas ref={canvasRef} width={1280} height={720} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />

            {exportFormat === '9:16' && (
              <>
                <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: '34.18%', background: 'rgba(0,0,0,0.7)', backdropFilter: 'grayscale(100%)', zIndex: 5, pointerEvents: 'none', borderRight: `2px dashed ${theme.accent}` }} />
                <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: '34.18%', background: 'rgba(0,0,0,0.7)', backdropFilter: 'grayscale(100%)', zIndex: 5, pointerEvents: 'none', borderLeft: `2px dashed ${theme.accent}` }} />
              </>
            )}
            {exportFormat === '1:1' && (
              <>
                <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: '21.875%', background: 'rgba(0,0,0,0.7)', backdropFilter: 'grayscale(100%)', zIndex: 5, pointerEvents: 'none', borderRight: `2px dashed ${theme.accent}` }} />
                <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: '21.875%', background: 'rgba(0,0,0,0.7)', backdropFilter: 'grayscale(100%)', zIndex: 5, pointerEvents: 'none', borderLeft: `2px dashed ${theme.accent}` }} />
              </>
            )}

            {activeAsset && displayMode === 'pip' && (
               <Rnd bounds="parent" position={{ x: pipRef.current.x, y: pipRef.current.y }} size={{ width: pipRef.current.width, height: pipRef.current.height }} onDrag={(e, d) => { pipRef.current.x = d.x; pipRef.current.y = d.y; }} onResize={(e, direction, ref, delta, position) => { pipRef.current.width = parseInt(ref.style.width, 10); pipRef.current.height = parseInt(ref.style.height, 10); pipRef.current.x = position.x; pipRef.current.y = position.y; }} style={{ position: 'absolute', zIndex: 10, cursor: 'move' }}>
                <div style={{ width: '100%', height: '100%' }} />
              </Rnd>
            )}
            {activeAsset && displayMode === 'weatherman' && (
               <Rnd bounds="parent" position={{ x: weathermanRef.current.x, y: weathermanRef.current.y }} size={{ width: weathermanRef.current.width, height: weathermanRef.current.height }} onDrag={(e, d) => { weathermanRef.current.x = d.x; weathermanRef.current.y = d.y; }} onResize={(e, direction, ref, delta, position) => { weathermanRef.current.width = parseInt(ref.style.width, 10); weathermanRef.current.height = parseInt(ref.style.height, 10); weathermanRef.current.x = position.x; weathermanRef.current.y = position.y; }} style={{ position: 'absolute', zIndex: 10, cursor: 'move', border: '2px dashed rgba(255, 255, 255, 0.5)', borderRadius: '12px' }}>
                <div style={{ width: '100%', height: '100%' }} />
              </Rnd>
            )}

            <video ref={hiddenVideoRef} width={1280} height={720} autoPlay muted playsInline onLoadedMetadata={(e) => e.target.play()} style={{ position: 'absolute', top: 0, left: 0, width: '1px', height: '1px', opacity: 0.01, zIndex: -1, pointerEvents: 'none' }} />
            
            {activeAsset && activeAsset.type === 'image' && <img ref={activeImgRef} src={`https://rapidrender-backend.onrender.com/proxy-image?url=${encodeURIComponent(activeAsset.isAlreadyHighRes ? activeAsset.high_res_url : activeAsset.thumb_url)}`} crossOrigin="anonymous" alt="active-b-roll" style={{ display: 'none' }} />}
            {activeAsset && activeAsset.type === 'image' && !activeAsset.isAlreadyHighRes && <img ref={highResImgRef} src={`https://rapidrender-backend.onrender.com/proxy-image?url=${encodeURIComponent(activeAsset.high_res_url)}`} crossOrigin="anonymous" alt="active-b-roll-highres" onLoad={handleHighResLoad} style={{ display: 'none' }} />}
            {loadingAsset && loadingAsset.type === 'image' && <img src={`https://rapidrender-backend.onrender.com/proxy-image?url=${encodeURIComponent(warmupCount >= WARMUP_THRESHOLD ? loadingAsset.high_res_url : loadingAsset.thumb_url)}`} crossOrigin="anonymous" alt="loading-b-roll" onLoad={handleImageLoad} onError={handleImageError} style={{ display: 'none' }} />}

            {activeAsset && (
              <button className="btn-hover" onClick={handleClearAsset} style={{ position: 'absolute', bottom: '20px', right: '20px', padding: '10px 20px', backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)', color: 'white', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', zIndex: 20 }}>
                ✕ Clear Display
              </button>
            )}
          </div>
        </div>

        {/* RIGHT PANEL */}
        <div className="glass-panel" style={{ width: '320px', backgroundColor: theme.panelBg, borderLeft: `1px solid ${theme.border}`, display: 'flex', flexDirection: 'column', padding: '25px', boxSizing: 'border-box', zIndex: 10, boxShadow: theme.shadow }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px', paddingBottom: '15px', borderBottom: `1px solid ${theme.border}` }}>
            <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: isRecording ? theme.record : theme.subtext, boxShadow: isRecording ? `0 0 10px ${theme.record}` : 'none' }}></div>
            <h2 style={{ fontSize: '16px', margin: 0, fontWeight: '700', letterSpacing: '0.5px' }}>Live Transcript</h2>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', color: theme.text, lineHeight: '1.8', fontSize: '15px', paddingRight: '10px' }}>
            {transcript} <span style={{ color: theme.accent, opacity: 0.9, fontWeight: '500' }}>{partialTranscript}</span>
          </div>
        </div>

        {/* MODAL OVERLAY REQUIREMENTS */}
        {showInstructions && (
          <div className="modal-overlay">
            <div className="instruction-box glass-panel">
              <h2 className={`gradient-title ${isDarkMode ? 'dark' : 'light'}`} style={{ fontSize: '28px', marginBottom: '10px', marginTop: 0 }}>
                Welcome to RapidRender!
              </h2>
              <p style={{ color: theme.subtext, fontSize: '14px', marginBottom: '20px', lineHeight: '1.6' }}>
                RapidRender uses AI to instantly generate a broadcast based on what you say. Here is how to create magic:
              </p>

              <div className="instruction-step">
                <div className="step-icon">🎙️</div>
                <div>
                  <strong style={{ display: 'block', fontSize: '15px', marginBottom: '4px' }}>Speak to Create</strong>
                  <span style={{ fontSize: '13px', color: theme.subtext }}>Hit Start Recording and just talk. The AI will listen and instantly inject B-Roll images onto your screen.</span>
                </div>
              </div>

              <div className="instruction-step">
                <div className="step-icon">🎛️</div>
                <div>
                  <strong style={{ display: 'block', fontSize: '15px', marginBottom: '4px' }}>Hotkeys</strong>
                  <span style={{ fontSize: '13px', color: theme.subtext }}>Look like a pro. Press <b>1</b> for PiP(Picture in Picture) Mode, <b>2</b> for Weatherman Mode, and <b>Esc</b> to clear the B-Roll instantly.</span>
                </div>
              </div>

              <div className="instruction-step" style={{ marginBottom: '10px' }}>
                <div className="step-icon">🤏</div>
                <div>
                  <strong style={{ display: 'block', fontSize: '15px', marginBottom: '4px' }}>Drag & Scale</strong>
                  <span style={{ fontSize: '13px', color: theme.subtext }}>Click and drag your webcam box or your AR silhouette anywhere on the canvas while recording.</span>
                </div>
              </div>

              {/* SYSTEM REQUIREMENTS */}
              <div style={{ marginTop: '20px', padding: '15px', backgroundColor: isDarkMode ? 'rgba(234, 179, 8, 0.1)' : 'rgba(245, 158, 11, 0.1)', border: `1px solid ${isDarkMode ? 'rgba(234, 179, 8, 0.3)' : 'rgba(245, 158, 11, 0.3)'}`, borderLeft: `4px solid ${isDarkMode ? '#facc15' : '#f59e0b'}`, borderRadius: '10px' }}>
                <strong style={{ display: 'block', fontSize: '14px', marginBottom: '8px', color: isDarkMode ? '#fde047' : '#b45309' }}>⚠️ System Requirements (Judges Note)</strong>
                <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '12px', color: theme.subtext, lineHeight: '1.6' }}>
                  <li><b>Browser:</b> Please use <b>Google Chrome</b> for the best possible results. (Safari blocks required background rendering).</li>
                  <li><b>Hardware:</b> AI processing runs entirely on your device. Modern CPU & 8GB+ RAM is recommended. <br/><i>Tip: Plug in your laptop power for maximum render speed.</i></li>
                  <li><b>Network:</b> 10+ Mbps upload speed recommended for real-time WebSocket AI streaming.</li>
                </ul>
              </div>

              <button className="btn-hover" onClick={closeInstructions} style={{ width: '100%', padding: '16px', marginTop: '25px', borderRadius: '12px', background: theme.accent, color: isDarkMode ? '#000' : '#fff', border: 'none', fontWeight: 'bold', fontSize: '16px', cursor: 'pointer', boxShadow: `0 4px 15px rgba(0,0,0,0.2)` }}>
                Let's Create!
              </button>
            </div>
          </div>
        )}

        {/* POST PRODUCTION STUDIO MODAL */}
        {recordedWebmBlob && !isRendering && (
          <div className="modal-overlay">
            <div className="instruction-box glass-panel" style={{ textAlign: 'center' }}>
              <h2 className={`gradient-title ${isDarkMode ? 'dark' : 'light'}`} style={{ fontSize: '32px', marginBottom: '10px', marginTop: 0 }}>Studio Export</h2>
              <p style={{ color: theme.subtext, fontSize: '14px', marginBottom: '30px' }}>Your video is ready. Choose your final export quality.</p>
              
              <div style={{ display: 'flex', gap: '10px', marginBottom: '30px' }}>
                {['720p', '1080p'].map(q => (
                  <button key={q} onClick={() => setExportQuality(q)} style={{ flex: 1, padding: '14px', borderRadius: '12px', border: exportQuality === q ? `2px solid ${theme.accent}` : `1px solid ${theme.border}`, background: exportQuality === q ? (isDarkMode ? 'rgba(56, 189, 248, 0.15)' : 'rgba(2, 132, 199, 0.1)') : 'none', color: theme.text, cursor: 'pointer', fontWeight: 'bold' }}>
                    {q === '720p' ? '🚀 Fast Render (720p)' : '🎬 Pro Quality (1080p)'}
                  </button>
                ))}
              </div>

              <button className="btn-hover" onClick={handleExport} style={{ width: '100%', padding: '18px', background: theme.accent, border: 'none', borderRadius: '12px', color: isDarkMode ? '#000' : '#fff', fontWeight: '900', fontSize: '16px', cursor: 'pointer', boxShadow: `0 4px 15px rgba(0,0,0,0.2)` }}>
                RENDER & DOWNLOAD MP4
              </button>
              <button onClick={() => setRecordedWebmBlob(null)} style={{ marginTop: '20px', background: 'none', border: 'none', color: theme.subtext, cursor: 'pointer', fontWeight: '600' }}>
                Discard Clip
              </button>
            </div>
          </div>
        )}

        {/* RENDERING PROGRESS OVERLAY */}
        {isRendering && (
          <div className="modal-overlay">
            <div className="instruction-box glass-panel" style={{ textAlign: 'center' }}>
              <h2 className={`gradient-title ${isDarkMode ? 'dark' : 'light'}`} style={{ fontSize: '28px', marginBottom: '10px', marginTop: 0 }}>Encoding Video...</h2>
              <div style={{ width: '100%', height: '10px', background: 'rgba(255,255,255,0.1)', borderRadius: '5px', margin: '25px 0', overflow: 'hidden' }}>
                <div style={{ width: `${renderProgress}%`, height: '100%', background: theme.accent, transition: 'width 0.4s ease' }} />
              </div>
              <p style={{ color: theme.subtext, fontSize: '14px' }}>Using FFmpeg.WASM to render locally. This may take a minute...</p>
            </div>
          </div>
        )}
        
      </div>
    </>
  );
}

export default App;