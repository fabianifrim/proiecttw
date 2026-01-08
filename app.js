const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');
const path = require('path');

const app = express();
const db = new sqlite3.Database('./payments.db');

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));


db.serialize(() => {
    db.run("CREATE TABLE IF NOT EXISTS users (username TEXT PRIMARY KEY, balance REAL DEFAULT 0, created_at DATETIME)");
    db.run("CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, amount REAL DEFAULT 0, reason TEXT, created_at DATETIME, created_by TEXT, total_collected REAL DEFAULT 0)");
    db.run("CREATE TABLE IF NOT EXISTS responses (id INTEGER PRIMARY KEY AUTOINCREMENT, request_id TEXT, username TEXT, status TEXT)");
});



app.post('/api/login', (req, res) => {
    const { username } = req.body;
    db.get("SELECT * FROM users WHERE username = ?", [username], (err, user) => {
        if (!user) return res.status(404).json({ error: "Utilizatorul nu exista." });
        res.json(user);
    });
});

app.post('/api/signup', (req, res) => {
    const { username } = req.body;
    db.run("INSERT INTO users (username, balance, created_at) VALUES (?, 0, ?)", [username, new Date().toISOString()], (err) => {
        if (err) return res.status(400).json({ error: "Username deja luat." });
        res.json({ success: true, username });
    });
});

app.get('/api/user/:username', (req, res) => {
    db.get("SELECT * FROM users WHERE username = ?", [req.params.username], (err, user) => {
        if (!user) return res.status(404).json({ error: "Nu exista" });
        res.json(user);
    });
});

app.post('/api/add-funds', (req, res) => {
    const { username, amount } = req.body;
    console.log('add-funds called with username:', username, 'amount:', amount);
    const numAmount = parseFloat(amount) || 0;
    console.log('Parsed amount:', numAmount);
    if (numAmount <= 0) {
        console.log('Invalid amount');
        return res.status(400).json({ error: "Suma invalida" });
    }

    db.run("UPDATE users SET balance = balance + ? WHERE username = ?", [numAmount, username], (err) => {
        if (err) {
            console.error('DB error:', err);
            return res.status(500).json({ error: "Eroare server" });
        }
        console.log('Balance updated for', username, 'by', numAmount);
        res.json({ success: true });
    });
});

app.get('/api/my-requests/:username', (req, res) => {
    db.all("SELECT * FROM requests WHERE created_by = ? ORDER BY created_at DESC", [req.params.username], (err, rows) => {
        res.json(rows || []);
    });
});

app.post('/api/requests', async (req, res) => {
    const { amount, reason, createdBy } = req.body;
    const numAmount = parseFloat(amount) || 0;
    const id = uuidv4();
    db.run("INSERT INTO requests (id, amount, reason, created_at, created_by) VALUES (?, ?, ?, ?, ?)",
        [id, numAmount, reason, new Date().toISOString(), createdBy],
        async () => {
            const url = "http://" + req.get('host') + "/#requestee/" + id;
            const qrCodeData = await QRCode.toDataURL(url);
            res.json({ id, qrCodeData });
        }
    );
});

app.get('/api/requests/:id', (req, res) => {
    db.get("SELECT * FROM requests WHERE id = ?", [req.params.id], (err, request) => {
        if (!request) return res.status(404).json({ error: "Nu exista" });
        res.json(request);
    });
});

app.post('/api/requests/:id/respond', (req, res) => {
    const { username, status } = req.body;
    const requestId = req.params.id;

    if (status === 'declined') {
        return db.run("INSERT INTO responses (request_id, username, status) VALUES (?, ?, ?)", [requestId, username, status], () => res.json({ success: true }));
    }

    db.get("SELECT * FROM requests WHERE id = ?", [requestId], (err, request) => {
        if (!request) return res.status(404).json({ error: "Cerere inexistenta" });
        const sum = parseFloat(request.amount) || 0;

        db.get("SELECT balance FROM users WHERE username = ?", [username], (err, payer) => {
            const payerBalance = parseFloat(payer ? payer.balance : 0);
            if (payerBalance < sum) {
                return res.status(400).json({ error: "Fonduri insuficiente!" });
            }

            db.serialize(() => {
                db.run("UPDATE users SET balance = balance - ? WHERE username = ?", [sum, username]);
                db.run("UPDATE users SET balance = balance + ? WHERE username = ?", [sum, request.created_by]);
                db.run("UPDATE requests SET total_collected = total_collected + ? WHERE id = ?", [sum, requestId]);
                db.run("INSERT INTO responses (request_id, username, status) VALUES (?, ?, 'accepted')", () => {
                    res.json({ success: true });
                });
            });
        });
    });
});

const PORT = 3000;
app.listen(PORT, () => console.log(`Server: http://localhost:${PORT}`));