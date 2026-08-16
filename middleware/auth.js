function requireAuth(...roles) {
  return (req, res, next) => {
    if (!req.session?.usuario) {
      return res.status(401).json({ error: 'No autenticado', redirect: '/login.html' });
    }
    if (roles.length && !roles.includes(req.session.usuario.rol)) {
      return res.status(403).json({ error: 'Acceso denegado' });
    }
    next();
  };
}

// El admin siempre tiene todos los permisos.
// Los demás necesitan que el admin les haya activado el permiso específico.
function requirePermission(permiso) {
  return (req, res, next) => {
    if (!req.session?.usuario) {
      return res.status(401).json({ error: 'No autenticado', redirect: '/login.html' });
    }
    const u = req.session.usuario;
    if (u.rol === 'admin' || u[permiso]) return next();
    return res.status(403).json({ error: 'No tenés permiso para esta acción' });
  };
}

module.exports = { requireAuth, requirePermission };
