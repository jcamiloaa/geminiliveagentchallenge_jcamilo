import React, { useState, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';

const CameraHUD = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activate = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      if (videoRef.current) {
        videoRef.current.srcObject = new MediaStream(stream.getVideoTracks());
      }
      setActive(true);

      // Initialize Speech Recognition
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = false;
        recognition.lang = 'es-ES';

        recognition.onresult = (event: any) => {
          const transcript = event.results[event.results.length - 1][0].transcript.trim().toLowerCase();
          console.log("Heard:", transcript);

          if (transcript.includes('gemini')) {
            console.log("Wake word detected!");
            window.parent.postMessage({ type: 'WAKE_WORD_DETECTED', command: transcript }, '*');
          }
        };

        recognition.onend = () => recognition.start();
        recognition.start();
      }
    } catch (err) {
      console.error("Camera/Mic access denied:", err);
      setError("Permiso denegado");
    }
  };

  return (
    <div className="flex flex-col items-center justify-center p-2 h-full bg-black/40 rounded-xl text-white select-none">
      {!active ? (
        <button
          onClick={activate}
          className="w-full h-full flex flex-col items-center justify-center rounded-lg bg-white/5 hover:bg-white/15 transition-colors cursor-pointer border border-white/20 text-white gap-2"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
          <span className="text-xs font-medium">{error ?? 'Activar Cámara y Mic'}</span>
          <span className="text-[10px] text-white/50">Click para iniciar</span>
        </button>
      ) : (
        <>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-28 object-cover rounded-lg shadow-inner"
            style={{ transform: 'scaleX(-1)' }}
          />
          <div className="mt-2 flex gap-2 text-[10px] text-emerald-400 font-medium">
            <span className="flex items-center gap-1">
              <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse"></div>
              Escuchando... di "Gemini"
            </span>
          </div>
        </>
      )}
    </div>
  );
};

const rootStyle = document.createElement("style");
rootStyle.textContent = `
  html, body, #root { width: 100%; height: 100%; margin: 0; background: transparent; overflow: hidden; }
`;
document.head.appendChild(rootStyle);

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <CameraHUD />
  </React.StrictMode>
);
