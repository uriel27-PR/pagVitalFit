import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import express from 'express';
import bodyParser from 'body-parser';
import session from 'express-session';
import multer from 'multer';
import mysql from 'mysql2/promise';

const app = express();
const PORT = 3001;

// Database Connection
const vitalfit = await mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'vitalfit',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Middleware Configuration
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, './views'));

// Middleware setup
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'views')));
app.use(session({
    secret: 'secreto',
    resave: false,
    saveUninitialized: true
}));

// Multer Configuration for File Uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// Middleware for Authentication
const isAuthenticated = (req, res, next) => {
    if (!req.session.userId) {
        return res.redirect('/iniciarsesion');
    }
    next();
};

// Root Route - Redirect to Principal Page
app.get('/', (req, res) => {
    res.render('principal');
});

// Principal Page Route
app.get('/principal', (req, res) => {
    res.render('principal');
});

// Login Page Route
app.get('/iniciarsesion', (req, res) => {
    res.render('iniciarsesion');
});

// Login Process
app.post('/iniciarsesion', async (req, res) => {
    const { email, password } = req.body;

    try {
        const [results] = await vitalfit.query('SELECT * FROM usuarios WHERE email = ? AND password = ?', [email, password]);

        if (results.length > 0) {
            const usuario = results[0];
            req.session.userId = usuario.id;
            return res.redirect('/opcionescuenta');
        } else {
            return res.status(401).render('iniciarsesion', { error: 'Credenciales incorrectas' });
        }
    } catch (err) {
        console.error('Error al iniciar sesión:', err);
        return res.status(500).send('Error al iniciar sesión');
    }
});

// User Registration Process
app.post('/register', async (req, res) => {
    const { nombre, apellido_paterno, apellido_materno, email, password, direccion } = req.body;

    try {
        const query = 'INSERT INTO usuarios (nombre, apellido_paterno, apellido_materno, email, password, direccion) VALUES (?, ?, ?, ?, ?, ?)';
        await vitalfit.query(query, [nombre, apellido_paterno, apellido_materno, email, password, direccion]);
        res.redirect('/iniciarsesion');
    } catch (err) {
        console.error('Error al registrar el usuario:', err);
        return res.status(500).send('Error al registrar el usuario');
    }
});

// Account Options Page
app.get('/opcionescuenta', isAuthenticated, async (req, res) => {
    try {
        const [results] = await vitalfit.query('SELECT * FROM usuarios WHERE id = ?', [req.session.userId]);

        if (results.length > 0) {
            const usuario = results[0];
            res.render('opcionescuenta', { usuario });
        } else {
            res.status(404).send('Usuario no encontrado');
        }
    } catch (err) {
        console.error('Error al obtener el usuario:', err);
        return res.status(500).send('Error al obtener el usuario');
    }
});

// Update Account Page
app.get('/actualizarcuenta', isAuthenticated, async (req, res) => {
    try {
        const [results] = await vitalfit.query('SELECT * FROM usuarios WHERE id = ?', [req.session.userId]);

        if (results.length > 0) {
            const usuario = results[0];
            res.render('actualizarcuenta', { usuario });
        } else {
            res.status(404).send('Usuario no encontrado');
        }
    } catch (err) {
        console.error('Error al obtener el usuario:', err);
        return res.status(500).send('Error al obtener el usuario');
    }
});

// Update Account Process
app.post('/actualizarcuenta', isAuthenticated, async (req, res) => {
    const { nombre, apellido_paterno, apellido_materno, email, direccion } = req.body;

    try {
        const query = 'UPDATE usuarios SET nombre = ?, apellido_paterno = ?, apellido_materno = ?, email = ?, direccion = ? WHERE id = ?';
        await vitalfit.query(query, [nombre, apellido_paterno, apellido_materno, email, direccion, req.session.userId]);
        res.redirect('/opcionescuenta');
    } catch (err) {
        console.error('Error al actualizar la cuenta:', err);
        return res.status(500).send('Error al actualizar la cuenta');
    }
});

// Delete Account Process
app.post('/eliminar', isAuthenticated, async (req, res) => {
    try {
        await vitalfit.query('DELETE FROM usuarios WHERE id = ?', [req.session.userId]);

        req.session.destroy(err => {
            if (err) {
                console.error('Error al destruir la sesión:', err);
                return res.status(500).send('Error al eliminar la cuenta');
            }
            res.redirect('/');
        });
    } catch (err) {
        console.error('Error al eliminar la cuenta:', err);
        return res.status(500).send('Error al eliminar la cuenta');
    }
});

// Newsletter Subscription
app.post('/suscribir-boletin', async (req, res) => {
    const { email } = req.body;

    if (!email || !email.includes('@')) {
        return res.status(400).send('Correo electrónico inválido');
    }

    try {
        const query = 'INSERT INTO boletin (email) VALUES (?)';
        await vitalfit.query(query, [email]);
        res.status(200).send('Suscripción exitosa');
    } catch (err) {
        console.error('Error al suscribir:', err);
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(400).send('Este correo ya está suscrito');
        }
        return res.status(500).send('Error al suscribir: ' + err.message);
    }
});

// Payment Page
app.get('/pago', isAuthenticated, (req, res) => {
    res.render('pago');
});

// Cart Routes
// Add to Cart
app.post('/agregar-al-carrito', isAuthenticated, async (req, res) => {
    const { productoId, cantidad } = req.body;

    try {
        const [producto] = await vitalfit.query('SELECT stock FROM productos WHERE id = ?', [productoId]);

        if (!producto || producto.stock < cantidad) {
            return res.status(400).json({ error: 'Stock insuficiente' });
        }

        const [cartItem] = await vitalfit.query(
            'SELECT * FROM carrito WHERE user_id = ? AND producto_id = ?',
            [req.session.userId, productoId]
        );

        if (cartItem) {
            await vitalfit.query(
                'UPDATE carrito SET cantidad = cantidad + ? WHERE id = ?',
                [cantidad, cartItem.id]
            );
        } else {
            await vitalfit.query(
                'INSERT INTO carrito (user_id, producto_id, cantidad) VALUES (?, ?, ?)',
                [req.session.userId, productoId, cantidad]
            );
        }

        res.status(200).json({ message: 'Producto agregado al carrito' });
    } catch (err) {
        console.error('Error al agregar al carrito:', err);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Get Cart
app.get('/carrito', isAuthenticated, async (req, res) => {
    try {
        const [items] = await vitalfit.query(`
            SELECT c.id, p.nombre, p.precio, c.cantidad, (p.precio * c.cantidad) AS total
            FROM carrito c
            JOIN productos p ON c.producto_id = p.id
            WHERE c.user_id = ?`, [req.session.userId]);

        const total = items.reduce((sum, item) => sum + item.total, 0);
        res.status(200).json({ items, total });
    } catch (err) {
        console.error('Error al obtener el carrito:', err);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Update Cart Item Quantity
app.put('/actualizar-carrito/:id', isAuthenticated, async (req, res) => {
    const { cantidad } = req.body;
    const cartItemId = req.params.id;

    try {
        await vitalfit.query('UPDATE carrito SET cantidad = ? WHERE id = ? AND user_id = ?', 
                             [cantidad, cartItemId, req.session.userId]);
        res.status(200).json({ message: 'Cantidad actualizada' });
    } catch (err) {
        console.error('Error al actualizar el carrito:', err);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Remove Item from Cart
app.delete('/eliminar-del-carrito/:id', isAuthenticated, async (req, res) => {
    const cartItemId = req.params.id;

    try {
        await vitalfit.query('DELETE FROM carrito WHERE id = ? AND user_id = ?', [cartItemId, req.session.userId]);
        res.status(200).json({ message: 'Producto eliminado del carrito' });
    } catch (err) {
        console.error('Error al eliminar del carrito:', err);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Clear Entire Cart
app.delete('/vaciar-carrito', isAuthenticated, async (req, res) => {
    try {
        await vitalfit.query('DELETE FROM carrito WHERE user_id = ?', [req.session.userId]);
        res.status(200).json({ message: 'Carrito vaciado' });
    } catch (err) {
        console.error('Error al vaciar el carrito:', err);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Start Server
app.listen(PORT, () => {
    console.log(`Servidor corriendo en: http://localhost:${PORT}`);
});