import { Router } from 'express';
import { getStats } from '../controllers/stats.controller.js';
import { getContactos } from '../controllers/contactos.controller.js';
import { getConversacion, getNuevos } from '../controllers/conversaciones.controller.js';

const router = Router();

router.get('/stats', getStats);
router.get('/contactos', getContactos);
router.get('/conversacion/:numero', getConversacion);
router.get('/nuevos/:numero/:desde', getNuevos);

export default router;