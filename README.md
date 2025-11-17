Apoyo Comunitario
=================

Plataforma que conecta Adultos Mayores con Voluntarios para solicitar y ofrecer ayuda, con chat en tiempo real.

Requisitos
- Node.js 18+

Instalación
1) cd project
2) npm install
3) Copia `.env.example` a `.env` y ajusta valores.
4) npm run start (o `npm run dev` para recarga con nodemon)

Estructura
- `server/` Backend Express + SQLite + Socket.io
- `public/` Frontend estático (HTML/CSS/JS)
- `database/ayuda_comunitaria.db` SQLite (auto-creada)

Endpoints principales
- POST `/api/auth/register` (multipart, campos: nombre, apellido, edad, documento_identificacion, telefono, correo, contrasena, rol, foto_perfil)
- POST `/api/auth/login`
- GET `/api/auth/me`
- POST `/api/solicitudes` (AM)
- GET `/api/solicitudes` (voluntario con filtros: tipo, lat, lng, max_km; AM con `?mine=1`)
- POST `/api/ofertas/:solicitudId` (voluntario)
- GET `/api/ofertas/solicitud/:solicitudId` (AM dueño)
- PUT `/api/ofertas/:id` body `{ estado: 'aceptada'|'rechazada' }`
- GET `/api/chats/:solicitudId`
- POST `/api/calificaciones/:solicitudId` body `{ puntuacion, comentario }` (AM con solicitud finalizada)

Notas de seguridad
- JWT en `Authorization: Bearer <token>`.
- Contraseñas con bcryptjs.
- HTTPS opcional con variables `SSL_KEY` y `SSL_CERT`.
