import { Router } from 'express';
import {
  getStats,
  getStatsProyectos,
  getStatsActividad,
  getStatsFuentes,
  getStatsCampanas,
  getStatsAnuncios,
  getStatsAnuncioProyectos,
  getStatsCreativos,
  getStatsMultiTouch,
} from '../controllers/stats.controller';
import { getContactos, getFichaContacto } from '../controllers/contactos.controller';
import { getConversacion, getNuevos } from '../controllers/conversaciones.controller';

const router = Router();

router.get('/stats', getStats);
router.get('/stats/proyectos', getStatsProyectos);
router.get('/stats/actividad', getStatsActividad);
router.get('/stats/fuentes', getStatsFuentes);
router.get('/stats/campanas', getStatsCampanas);
router.get('/stats/anuncios', getStatsAnuncios);
router.get('/stats/anuncios/proyectos', getStatsAnuncioProyectos);
router.get('/stats/creativos', getStatsCreativos);
router.get('/stats/multitouch', getStatsMultiTouch);
router.get('/contactos', getContactos);
router.get('/contactos/:numero/ficha', getFichaContacto);
router.get('/conversacion/:numero', getConversacion);
router.get('/nuevos/:numero/:desde', getNuevos);

export default router;