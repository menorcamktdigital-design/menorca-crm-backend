import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { authMiddleware } from './middleware/auth.js';
import routes from './routes/index.js';
import { getMediaWa } from './controllers/media.controller.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Media pública (sin auth): la sirven <img>/<video>/<audio> que no mandan Bearer.
// El media_id es un id opaco de Meta, imposible de adivinar.
app.get('/media/wa/:media_id', getMediaWa);

app.use('/api/v1', authMiddleware, routes);

app.listen(PORT, () => {
  console.log(`Backend corriendo en puerto ${PORT}`);
});