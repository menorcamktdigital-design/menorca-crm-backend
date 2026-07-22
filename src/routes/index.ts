import { Router } from 'express';
import {
  getStats,
  getStatsProyectos,
  getStatsActividad,
  getStatsFuentes,
  getStatsCampanas,
  getStatsAnuncios,
  getStatsAnuncioProyectos,
  getStatsAnuncioLeads,
  getStatsCreativos,
  getStatsMultiTouch,
} from '../controllers/stats.controller';
import { getContactos, getFichaContacto, getVisitas } from '../controllers/contactos.controller';
import { getConversacion, getNuevos, getMediaProxy, getCreativoImagen } from '../controllers/conversaciones.controller';
import { getFormularios, getFormulariosStats, getFormulariosFunnel } from '../controllers/formularios.controller';
import {
  getFormulariosTiktok,
  getFormulariosTiktokStats,
  getFormulariosTiktokFunnel,
  getTiktokCreativoImagen,
} from '../controllers/formulariosTiktok.controller';
import {
  getFormulariosWeb,
  getFormulariosWebStats,
  getFormulariosWebFunnel,
} from '../controllers/formulariosWeb.controller';

const router = Router();

router.get('/stats', getStats);
router.get('/stats/proyectos', getStatsProyectos);
router.get('/stats/actividad', getStatsActividad);
router.get('/stats/fuentes', getStatsFuentes);
router.get('/stats/campanas', getStatsCampanas);
router.get('/stats/anuncios', getStatsAnuncios);
router.get('/stats/anuncios/proyectos', getStatsAnuncioProyectos);
router.get('/stats/anuncios/leads', getStatsAnuncioLeads);
router.get('/stats/creativos', getStatsCreativos);
router.get('/stats/multitouch', getStatsMultiTouch);
router.get('/contactos', getContactos);
router.get('/visitas', getVisitas);
router.get('/contactos/:numero/ficha', getFichaContacto);
router.get('/conversacion/:numero', getConversacion);
router.get('/nuevos/:numero/:desde', getNuevos);
router.get('/media/tiktok/:file', getTiktokCreativoImagen);
router.get('/media/:imagen_id', getMediaProxy);
router.get('/creativo/:ad_id/imagen', getCreativoImagen);
router.get('/formularios/stats', getFormulariosStats);
router.get('/formularios/funnel', getFormulariosFunnel);
router.get('/formularios/tiktok/stats', getFormulariosTiktokStats);
router.get('/formularios/tiktok/funnel', getFormulariosTiktokFunnel);
router.get('/formularios/tiktok', getFormulariosTiktok);
router.get('/formularios/web/stats', getFormulariosWebStats);
router.get('/formularios/web/funnel', getFormulariosWebFunnel);
router.get('/formularios/web', getFormulariosWeb);
router.get('/formularios', getFormularios);

export default router;