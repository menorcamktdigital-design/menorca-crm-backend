import { Router } from 'express';
import { getStats, getStatsProyectos, getStatsActividad } from '../controllers/stats.controller';
import { getContactos } from '../controllers/contactos.controller';
import { getConversacion, getNuevos } from '../controllers/conversaciones.controller';

const router = Router();

router.get('/stats', getStats);
router.get('/stats/proyectos', getStatsProyectos);
router.get('/stats/actividad', getStatsActividad);
router.get('/contactos', getContactos);
router.get('/conversacion/:numero', getConversacion);
router.get('/nuevos/:numero/:desde', getNuevos);

export default router;