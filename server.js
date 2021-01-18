const PORT = process.env.PORT || 8000;
const https = require('https');
const util = require('util');
const fs = require('fs');
const fsReadFile = util.promisify(fs.readFile);

async function onRequest(request, response) {
  request.on('error', (error) => { console.error(error); });
  response.on('error', (error) => { console.error(error); });
  if (request.method === 'GET') { get(request, response) }
}

async function get(request, response) {
  if (request.url === '/') { request.url = '/index.html'; }
  let answer = await fsReadFile('./client' + request.url).catch(() => { });
  if (!answer) { answer = await fsReadFile('./client/index.html'); }
  response.writeHead(200, {});
  response.end(answer);
}

async function start() {
  https.createServer({
    key: fs.readFileSync('./ssl/key.pem'),
    cert: fs.readFileSync('./ssl/cert.pem')
  }, onRequest).listen(PORT);
  console.log(`server running at https://localhost:${PORT}`);
}

start();