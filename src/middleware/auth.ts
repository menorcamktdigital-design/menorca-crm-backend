import type { Request, Response, NextFunction } from 'express';

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization;
  if (token !== `Bearer ${process.env.API_TOKEN}`) {
    res.status(401).json({ error: 'No autorizado' });
    return;
  }
  next();
}