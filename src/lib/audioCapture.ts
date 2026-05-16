type ActiveSession = {
  audioContext: AudioContext;
  mediaStream: MediaStream;
  sourceNode: MediaStreamAudioSourceNode;
  processorNode: ScriptProcessorNode;
  sampleRate: number;
  chunks: Float32Array[];
};

function mergeChunks(chunks: Float32Array[]): Float32Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Float32Array(totalLength);

  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  return merged;
}

function downsampleBuffer(input: Float32Array, inputSampleRate: number, targetSampleRate: number): Float32Array {
  if (inputSampleRate === targetSampleRate) {
    return input;
  }

  const ratio = inputSampleRate / targetSampleRate;
  const outputLength = Math.round(input.length / ratio);
  const output = new Float32Array(outputLength);

  let outputOffset = 0;
  let inputOffset = 0;

  while (outputOffset < output.length) {
    const nextInputOffset = Math.round((outputOffset + 1) * ratio);
    let accumulator = 0;
    let sampleCount = 0;

    for (let index = inputOffset; index < nextInputOffset && index < input.length; index += 1) {
      accumulator += input[index];
      sampleCount += 1;
    }

    output[outputOffset] = sampleCount > 0 ? accumulator / sampleCount : 0;
    outputOffset += 1;
    inputOffset = nextInputOffset;
  }

  return output;
}

function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeString = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }

  return buffer;
}

export class AudioCapture {
  private activeSession: ActiveSession | null = null;

  public async warmup(): Promise<void> {
    return Promise.resolve();
  }

  public async start(): Promise<void> {
    if (this.activeSession) {
      return;
    }

    const mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: false
    });

    const audioContext = new AudioContext();
    const sourceNode = audioContext.createMediaStreamSource(mediaStream);
    const processorNode = audioContext.createScriptProcessor(4096, 1, 1);
    const chunks: Float32Array[] = [];

    processorNode.onaudioprocess = (event) => {
      const samples = event.inputBuffer.getChannelData(0);
      chunks.push(new Float32Array(samples));
    };

    sourceNode.connect(processorNode);
    processorNode.connect(audioContext.destination);

    this.activeSession = {
      audioContext,
      mediaStream,
      sourceNode,
      processorNode,
      sampleRate: audioContext.sampleRate,
      chunks
    };
  }

  public async stop(): Promise<ArrayBuffer> {
    const session = this.activeSession;
    if (!session) {
      return new ArrayBuffer(0);
    }

    session.processorNode.disconnect();
    session.sourceNode.disconnect();
    session.mediaStream.getTracks().forEach((track) => track.stop());
    await session.audioContext.close();
    this.activeSession = null;

    const mergedSamples = mergeChunks(session.chunks);
    const downsampled = downsampleBuffer(mergedSamples, session.sampleRate, 16000);
    return encodeWav(downsampled, 16000);
  }
}
