const CONSUMER_IP = process.env.CONSUMER_IP || '127.0.0.1';
const CONSUMER_PORT = process.env.PORT || 9999;
const mediasoup = require('mediasoup');
const WebSocket = require('ws');

let worker;
let router;
let transport;
let pipeTransport;

let pipeVideo;
let pipeAudio;
let videoConsumer;
let audioConsumer;

const mediaCodecs = [
  { kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2 },
  // { kind: 'video', mimeType: 'video/VP8', clockRate: 90000, parameters: { 'x-google-start-bitrate': 1000 } },
  // { kind: 'video', mimeType: 'video/VP9', clockRate: 90000, parameters: { 'profile-id': 2, 'x-google-start-bitrate': 1000 } },
  // { kind: 'video', mimeType: 'video/h264', clockRate: 90000, parameters: { 'packetization-mode': 1, 'profile-level-id': '4d0032', 'level-asymmetry-allowed': 1, 'x-google-start-bitrate': 1000 } },
  { kind: 'video', mimeType: 'video/h264', clockRate: 90000, parameters: { 'packetization-mode': 1, 'profile-level-id': '42e01f', 'level-asymmetry-allowed': 1, 'x-google-start-bitrate': 1000 } }
];

async function createWorkers() {
  worker = await mediasoup.createWorker();
  router = await worker.createRouter({ mediaCodecs: mediaCodecs });
}

async function createPipe() {
  pipeTransport = await router.createPipeTransport({ listenIp: CONSUMER_IP });
}

async function connectPipe(message) {
  await pipeTransport.connect({ ip: message.ip, port: message.port });
  return {
    type: 'connectPipe',
    ip: pipeTransport.tuple.localIp,
    port: pipeTransport.tuple.localPort
  };
}

async function createTransport() {
  transport = await router.createWebRtcTransport({
    listenIps: [{ ip: CONSUMER_IP, announcedIp: null }],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true
  });

  return {
    id: transport.id,
    iceParameters: transport.iceParameters,
    iceCandidates: transport.iceCandidates,
    dtlsParameters: transport.dtlsParameters,
    routerRtpCapabilities: router.rtpCapabilities
  };
}

async function produceStream(message) {
  if (message.kind === 'video') {
    pipeVideo = await pipeTransport.produce({ id: message.id, kind: 'video', rtpParameters: message.rtpParameters });
  }
  if (message.kind === 'audio') {
    pipeAudio = await pipeTransport.produce({ id: message.id, kind: 'audio', rtpParameters: message.rtpParameters });
  }
}

async function consumeStream(message) {
  videoConsumer = await transport.consume({ producerId: pipeVideo.id, rtpCapabilities: message.rtpCapabilities });
  audioConsumer = await transport.consume({ producerId: pipeAudio.id, rtpCapabilities: message.rtpCapabilities });

  return {
    video: {
      id: videoConsumer.id,
      kind: videoConsumer.kind,
      rtpParameters: videoConsumer.rtpParameters,
      type: videoConsumer.type,
      producerId: pipeVideo.id
    },
    audio: {
      id: audioConsumer.id,
      kind: audioConsumer.kind,
      rtpParameters: audioConsumer.rtpParameters,
      type: audioConsumer.type,
      producerId: pipeAudio.id
    }
  };
}

async function handleMessage(message) {
  if (!message.type) { return; }
  console.log('type:', message.type);

  let answer = {};
  switch (message.type) {
    case 'connectPipe':
      answer = await connectPipe(message);
      break;
    case 'createTransport':
      answer = await createTransport(message);
      break;
    case 'connectTransport':
      await transport.connect({ dtlsParameters: message.dtlsParameters });
      break;
    case 'produce':
      await produceStream(message);
      break;
    case 'consume':
      answer = await consumeStream(message);
      break;
  }

  return { ...answer, transaction: message.transaction };
}

async function start() {
  console.log('starting consumer server...');

  let websocketServer = new WebSocket.Server({ 'port': CONSUMER_PORT });
  websocketServer.on('connection', (websocket) => {
    websocket.on('message', async (message) => {
      let answer = await handleMessage(JSON.parse(message));
      websocket.send(JSON.stringify(answer));
    });
  });

  await createWorkers();
  await createPipe();

  console.log('consumer server is running');
}

start();