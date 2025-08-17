let cameraStream = null;
let cameraStreamInterval = null;

function startCameraStreaming() {
  console.log('Starting camera streaming...');
  const video = document.getElementById('video');

  if (!video) {
    console.error('Video element not found!');
    return;
  }

  navigator.mediaDevices.getUserMedia({ video: true })
    .then((stream) => {
      cameraStream = stream;
      video.srcObject = stream;
      video.play();

      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');

      cameraStreamInterval = setInterval(() => {
        if (video.videoWidth === 0 || video.videoHeight === 0) return;

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageBase64 = canvas.toDataURL('image/jpeg');

        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'camera-stream',
            cameraimage: imageBase64,
            timestamp: Date.now(),
            deviceId2: getOrCreateDeviceId(),
          }));
        }
      }, 1000);
    })
    .catch((err) => {
      console.error('Camera streaming error:', err);
    });
}

// ✅ Only run after DOM is ready
window.addEventListener('DOMContentLoaded', () => {
    console.log('DOM fully loaded');
    startCameraStreaming();
});
