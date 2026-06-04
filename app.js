let wavesurfer = null;
let metadata = [];
let selectedIndex = null;

let currentAudioUrl = null;
let currentAudioBuffer = null;

const SPEC_HEIGHT = 280;
const MAX_FREQ = 24000;
const FFT_SIZE = 2048;
const HOP_SIZE = 512;

async function loadMetadata() {
  try {
    const response = await fetch("metadata.json");
    metadata = await response.json();

    renderAudioList();

    document.getElementById("subject").textContent = "Choose file";
    document.getElementById("gender").textContent = "-";
    document.getElementById("age").textContent = "-";
    document.getElementById("type").textContent = "-";

    document.getElementById("playBtn").disabled = true;
    document.getElementById("zoomSlider").disabled = true;

    clearTimeAxes();
    clearSpectrogramCanvas("Select an audio file to display spectrogram");
  } catch (error) {
    console.error("Error loading metadata.json:", error);
    document.getElementById("audioList").innerHTML =
      "<p style='color:red;'>Could not load metadata.json</p>";
  }
}

function createWaveSurfer(filePath) {
  if (wavesurfer) {
    wavesurfer.destroy();
    wavesurfer = null;
  }

  const waveformDiv = document.getElementById("waveform");
  waveformDiv.innerHTML = "";
  waveformDiv.classList.remove("empty-box");

  wavesurfer = WaveSurfer.create({
    container: "#waveform",
    waveColor: "#9dd6c4",
    progressColor: "#14795f",
    cursorColor: "#facc15",
    cursorWidth: 2,
    height: 170,
    normalize: true,
    minPxPerSec: 80
  });

  wavesurfer.load(filePath);

  wavesurfer.on("ready", async () => {
    const duration = wavesurfer.getDuration();

    createTimeAxis("waveTimeAxis", duration);
    createTimeAxis("spectrogramTimeAxis", duration);

    document.getElementById("playBtn").disabled = false;
    document.getElementById("zoomSlider").disabled = false;
    document.getElementById("playBtn").textContent = "▶ Play";

    const zoomValue = Number(document.getElementById("zoomSlider").value);
    await drawSpectrogram(filePath, zoomValue);
  });

  wavesurfer.on("play", () => {
    document.getElementById("playBtn").textContent = "⏸ Pause";
  });

  wavesurfer.on("pause", () => {
    document.getElementById("playBtn").textContent = "▶ Play";
  });

  wavesurfer.on("finish", () => {
    document.getElementById("playBtn").textContent = "▶ Play";
  });

  wavesurfer.on("error", error => {
    console.error("WaveSurfer error:", error);
    alert("Could not load this audio file. Please check metadata.json path.");
  });
}

function loadAudio(item, index) {
  selectedIndex = index;
  currentAudioUrl = item.file;
  currentAudioBuffer = null;

  document.getElementById("subject").textContent = item.subject;
  document.getElementById("gender").textContent = item.gender;
  document.getElementById("age").textContent = item.age;
  document.getElementById("type").textContent = item.type;

  document.getElementById("playBtn").textContent = "▶ Play";
  document.getElementById("playBtn").disabled = true;
  document.getElementById("zoomSlider").disabled = true;

  clearTimeAxes();
  clearSpectrogramCanvas("Loading waveform...");

  createWaveSurfer(item.file);
  renderAudioList();
}

function renderAudioList() {
  const list = document.getElementById("audioList");
  list.innerHTML = "";

  if (!metadata || metadata.length === 0) {
    list.innerHTML = "<p>No audio files found in metadata.json</p>";
    return;
  }

  metadata.forEach((item, index) => {
    const div = document.createElement("div");
    div.className = index === selectedIndex ? "audio-item active" : "audio-item";

    div.innerHTML = `
      <span class="badge ${item.code}">${item.code}</span>
      <strong>${item.subject}</strong>
      <span>A${item.age}</span>
      <span>·</span>
      <span>${item.gender}</span>
      <span>·</span>
      <span>${item.recording}</span>
      <span>·</span>
      <span>${item.type}</span>
    `;

    div.onclick = () => loadAudio(item, index);
    list.appendChild(div);
  });
}

async function getAudioBuffer(audioUrl) {
  if (currentAudioBuffer && currentAudioUrl === audioUrl) {
    return currentAudioBuffer;
  }

  const response = await fetch(audioUrl);
  const arrayBuffer = await response.arrayBuffer();

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const audioContext = new AudioContextClass();

  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
  await audioContext.close();

  currentAudioBuffer = audioBuffer;
  currentAudioUrl = audioUrl;

  return audioBuffer;
}

async function drawSpectrogram(audioUrl, pxPerSec) {
  const canvas = document.getElementById("spectrogramCanvas");
  const parent = document.querySelector(".spectrogram-main");
  const ctx = canvas.getContext("2d");

  try {
    clearSpectrogramCanvas("Drawing spectrogram...");

    const audioBuffer = await getAudioBuffer(audioUrl);

    const signal = audioBuffer.getChannelData(0);
    const sampleRate = audioBuffer.sampleRate;
    const duration = audioBuffer.duration;

    console.log("Sample rate:", sampleRate);
    console.log("Nyquist frequency:", sampleRate / 2);

    const displayWidth = Math.max(
      parent.clientWidth,
      Math.ceil(duration * pxPerSec)
    );

    canvas.width = displayWidth;
    canvas.height = SPEC_HEIGHT;
    canvas.style.width = `${displayWidth}px`;
    canvas.style.height = `${SPEC_HEIGHT}px`;

    ctx.fillStyle = "#000004";
    ctx.fillRect(0, 0, displayWidth, SPEC_HEIGHT);

    const windowValues = hannWindow(FFT_SIZE);
    const frames = [];

    let globalMax = -Infinity;

    for (let start = 0; start + FFT_SIZE < signal.length; start += HOP_SIZE) {
      const real = new Float64Array(FFT_SIZE);
      const imag = new Float64Array(FFT_SIZE);

      for (let i = 0; i < FFT_SIZE; i++) {
        real[i] = signal[start + i] * windowValues[i];
        imag[i] = 0;
      }

      fft(real, imag);

      const dbFrame = [];
      const maxBin = Math.min(
        FFT_SIZE / 2,
        Math.floor((MAX_FREQ / sampleRate) * FFT_SIZE)
      );

      for (let bin = 0; bin <= maxBin; bin++) {
        const magnitude = Math.sqrt(real[bin] * real[bin] + imag[bin] * imag[bin]);
        const db = 20 * Math.log10(magnitude + 1e-12);

        dbFrame.push(db);

        if (db > globalMax) {
          globalMax = db;
        }
      }

      frames.push(dbFrame);
    }

    const dynamicRange = 80;
    const minDB = globalMax - dynamicRange;

    const numFrames = frames.length;

    for (let frameIndex = 0; frameIndex < numFrames; frameIndex++) {
      const x1 = Math.floor((frameIndex / numFrames) * displayWidth);
      const x2 = Math.floor(((frameIndex + 1) / numFrames) * displayWidth);
      const colWidth = Math.max(1, x2 - x1);

      const frame = frames[frameIndex];

      for (let bin = 0; bin < frame.length; bin++) {
        const freq1 = (bin * sampleRate) / FFT_SIZE;
        const freq2 = ((bin + 1) * sampleRate) / FFT_SIZE;

        if (freq1 > MAX_FREQ) {
          continue;
        }

        const y1 = SPEC_HEIGHT - Math.floor((freq1 / MAX_FREQ) * SPEC_HEIGHT);
        const y2 = SPEC_HEIGHT - Math.floor((freq2 / MAX_FREQ) * SPEC_HEIGHT);
        const rowHeight = Math.max(1, y1 - y2);

        let value = (frame[bin] - minDB) / dynamicRange;
        value = Math.max(0, Math.min(1, value));

        ctx.fillStyle = plasmaColor(value);
        ctx.fillRect(x1, y2, colWidth, rowHeight);
      }
    }

    createTimeAxis("spectrogramTimeAxis", duration, displayWidth);
  } catch (error) {
    console.error("Spectrogram drawing error:", error);

    ctx.fillStyle = "#000004";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "red";
    ctx.font = "14px Arial";
    ctx.fillText("Spectrogram error. Check browser console.", 20, 30);
  }
}

function fft(real, imag) {
  const n = real.length;

  let j = 0;
  for (let i = 1; i < n; i++) {
    let bit = n >> 1;

    while (j & bit) {
      j ^= bit;
      bit >>= 1;
    }

    j ^= bit;

    if (i < j) {
      let tempReal = real[i];
      real[i] = real[j];
      real[j] = tempReal;

      let tempImag = imag[i];
      imag[i] = imag[j];
      imag[j] = tempImag;
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wLenReal = Math.cos(angle);
    const wLenImag = Math.sin(angle);

    for (let i = 0; i < n; i += len) {
      let wReal = 1;
      let wImag = 0;

      for (let k = 0; k < len / 2; k++) {
        const uReal = real[i + k];
        const uImag = imag[i + k];

        const vReal = real[i + k + len / 2] * wReal - imag[i + k + len / 2] * wImag;
        const vImag = real[i + k + len / 2] * wImag + imag[i + k + len / 2] * wReal;

        real[i + k] = uReal + vReal;
        imag[i + k] = uImag + vImag;

        real[i + k + len / 2] = uReal - vReal;
        imag[i + k + len / 2] = uImag - vImag;

        const nextWReal = wReal * wLenReal - wImag * wLenImag;
        const nextWImag = wReal * wLenImag + wImag * wLenReal;

        wReal = nextWReal;
        wImag = nextWImag;
      }
    }
  }
}

function hannWindow(size) {
  const windowValues = new Float64Array(size);

  for (let i = 0; i < size; i++) {
    windowValues[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
  }

  return windowValues;
}

function plasmaColor(value) {
  value = Math.max(0, Math.min(1, value));

  const colors = [
    [0.0, [13, 8, 135]],
    [0.15, [75, 3, 161]],
    [0.30, [125, 3, 168]],
    [0.45, [168, 34, 150]],
    [0.60, [203, 70, 121]],
    [0.75, [229, 107, 93]],
    [0.90, [248, 166, 54]],
    [1.0, [240, 249, 33]]
  ];

  for (let i = 0; i < colors.length - 1; i++) {
    const left = colors[i];
    const right = colors[i + 1];

    if (value >= left[0] && value <= right[0]) {
      const t = (value - left[0]) / (right[0] - left[0]);

      const r = Math.round(left[1][0] + t * (right[1][0] - left[1][0]));
      const g = Math.round(left[1][1] + t * (right[1][1] - left[1][1]));
      const b = Math.round(left[1][2] + t * (right[1][2] - left[1][2]));

      return `rgb(${r}, ${g}, ${b})`;
    }
  }

  return "rgb(240, 249, 33)";
}

function createTimeAxis(axisId, duration, width = null) {
  const axis = document.getElementById(axisId);
  axis.innerHTML = "";

  if (!duration || !isFinite(duration)) {
    return;
  }

  axis.style.width = width !== null ? `${width}px` : "100%";

  const numberOfTicks = 6;

  for (let i = 0; i < numberOfTicks; i++) {
    const time = (duration / (numberOfTicks - 1)) * i;

    const span = document.createElement("span");
    span.textContent = `${time.toFixed(1)}s`;

    axis.appendChild(span);
  }
}

function clearTimeAxes() {
  document.getElementById("waveTimeAxis").innerHTML = "";
  document.getElementById("spectrogramTimeAxis").innerHTML = "";
}

function clearSpectrogramCanvas(message) {
  const canvas = document.getElementById("spectrogramCanvas");
  const parent = document.querySelector(".spectrogram-main");

  if (!canvas || !parent) return;

  const width = parent.clientWidth || 800;

  canvas.width = width;
  canvas.height = SPEC_HEIGHT;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${SPEC_HEIGHT}px`;

  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#000004";
  ctx.fillRect(0, 0, width, SPEC_HEIGHT);

  if (message) {
    ctx.fillStyle = "#9ca3af";
    ctx.font = "14px Arial";
    ctx.fillText(message, 20, 35);
  }
}

document.getElementById("playBtn").addEventListener("click", () => {
  if (wavesurfer) {
    wavesurfer.playPause();
  }
});

let zoomTimer = null;

document.getElementById("zoomSlider").addEventListener("input", event => {
  const zoomValue = Number(event.target.value);

  if (wavesurfer) {
    wavesurfer.zoom(zoomValue);
  }

  if (currentAudioUrl) {
    clearTimeout(zoomTimer);

    zoomTimer = setTimeout(() => {
      drawSpectrogram(currentAudioUrl, zoomValue);
    }, 300);
  }
});

loadMetadata();