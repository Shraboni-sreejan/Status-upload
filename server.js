const express = require('express');
const bodyParser = require('body-parser');
const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const fs = require('fs-extra');
const fetch = require('node-fetch');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { exec } = require('child_process');

const app = express();
app.use(bodyParser.json());
app.use(express.static('public'));

let sock;

async function startBaileys() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');
  sock = makeWASocket({ 
    auth: state, 
    printQRInTerminal: true,
    logger: require('pino')({ level: 'silent' })
  });
  
  sock.ev.on('creds.update', saveCreds);
  
  sock.ev.on('connection.update', (update) => {
    if(update.connection === 'close') {
      if(update.lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) {
        startBaileys();
      }
    }
  });
}

async function processSong(mp3Url, number) {
  const tempMp3 = `temp_${uuidv4()}.mp3`;
  const tempPtt = `song_${uuidv4()}.ogg`;
  
  try {
    const response = await fetch(mp3Url);
    await fs.writeFile(tempMp3, Buffer.from(await response.arrayBuffer()));
    
    exec(`ffmpeg -i "${tempMp3}" -ar 16000 -ac 1 -c:a libopus "${tempPtt}" -y`, async () => {
      const userJid = `${number}@s.whatsapp.net`;
      await sock.sendMessage(userJid, {
        audio: await fs.readFile(tempPtt),
        ptt: true,
        mimetype: 'audio/ogg; codecs=opus'
      });
      await fs.remove(tempMp3);
      await fs.remove(tempPtt);
    });
  } catch(e) {}
}

app.post('/api/send-song', async (req, res) => {
  const { number, mp3Link } = req.body;
  
  try {
    const pairCode = await sock.requestPairingCode({ phoneNumber: number });
    
    const handler = sock.ev.on('connection.update', async (update) => {
      if(update.connection === 'open') {
        await processSong(mp3Link, number);
        sock.ev.off('connection.update', handler);
      }
    });
    
    res.json({ pairCode: pairCode.code });
  } catch(error) {
    res.status(400).json({ error: error.message });
  }
});

startBaileys();
app.listen(3000, () => console.log('Server running'));
