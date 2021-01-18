const PRODUCER_IP = process.env.PRODUCER_IP || '127.0.0.1';
const CONSUMER_IP = process.env.CONSUMER_IP || '127.0.0.1';
const PRODUCER_PORT = process.env.PRODUCER_PORT || 8888;
const CONSUMER_PORT = process.env.CONSUMER_PORT || 9999;
const mediasoup = require('mediasoup');
const WebSocket = require('ws');

let ws;
let worker;
let router;
let transport;
let pipeTransport;

let pipeVideo;
let pipeAudio;
let videoProducer;
let audioProducer;

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
  pipeTransport = await router.createPipeTransport({ listenIp: PRODUCER_IP });
  ws.send(JSON.stringify({
    type: 'connectPipe',
    ip: pipeTransport.tuple.localIp,
    port: pipeTransport.tuple.localPort
  }));
}

async function connectPipe(message) {
  await pipeTransport.connect({ ip: message.ip, port: message.port });
}

async function createTransport() {
  transport = await router.createWebRtcTransport({
    listenIps: [{ ip: PRODUCER_IP, announcedIp: null }],
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
    videoProducer = await transport.produce({ kind: 'video', rtpParameters: message.rtpParameters });
    pipeVideo = await pipeTransport.consume({ producerId: videoProducer.id });
    ws.send(JSON.stringify({
      type: 'produce',
      id: videoProducer.id,
      kind: 'video',
      rtpParameters: pipeVideo.rtpParameters
    }));

    return { id: videoProducer.id };
  }

  if (message.kind === 'audio') {
    audioProducer = await transport.produce({ kind: 'audio', rtpParameters: message.rtpParameters });
    pipeAudio = await pipeTransport.consume({ producerId: audioProducer.id });
    ws.send(JSON.stringify({
      type: 'produce',
      id: audioProducer.id,
      kind: 'audio',
      rtpParameters: pipeAudio.rtpParameters
    }));

    return { id: audioProducer.id };
  }
}

async function handleMessage(message) {
  if (!message.type) { return; }
  console.log('type:', message.type);

  let answer = {};
  switch (message.type) {
    case 'connectPipe':
      await connectPipe(message);
      break;
    case 'createTransport':
      answer = await createTransport(message);
      break;
    case 'connectTransport':
      await transport.connect({ dtlsParameters: message.dtlsParameters });
      break;
    case 'produce':
      answer = await produceStream(message);
      break;
  }

  return { ...answer, transaction: message.transaction };
}

async function connectToConsumer() {
  return new Promise((resolve, reject) => {
    ws = new WebSocket(`ws://${CONSUMER_IP}:${CONSUMER_PORT}`);
    ws.on('message', (message) => { handleMessage(JSON.parse(message)); });
    ws.on('open', (event) => { resolve(event); });
    ws.on('error', (error) => { reject(error); });
  });
}

async function start() {
  console.log('starting producer server...');

  let websocketServer = new WebSocket.Server({ 'port': PRODUCER_PORT });
  websocketServer.on('connection', (websocket) => {
    websocket.on('message', async (message) => {
      let answer = await handleMessage(JSON.parse(message));
      websocket.send(JSON.stringify(answer));
    });
  });

  await new Promise((resolve) => setTimeout(resolve, 1000));

  await connectToConsumer();
  await createWorkers();
  await createPipe();

  console.log('producer server is running');
}

start();