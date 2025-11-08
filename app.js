const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
require('dotenv').config();

const app = express();

// Config
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use('/images', express.static(path.join(__dirname)));

app.use(
	session({
 		secret: process.env.SESSION_SECRET || 'change-me',
 		resave: false,
 		saveUninitialized: false,
 		cookie: { httpOnly: true, sameSite: 'lax' }
 	})
);

// Simple JSON storage file
const DATA_DIR = path.join(__dirname, 'data');
const JSON_DB = path.join(DATA_DIR, 'users.json');
const CSV_FILE = path.join(DATA_DIR, 'users.csv');
const EVENTS_DB = path.join(DATA_DIR, 'events.json');

function ensureDataFiles() {
	if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
	if (!fs.existsSync(JSON_DB)) fs.writeFileSync(JSON_DB, JSON.stringify([] , null, 2));
	if (!fs.existsSync(CSV_FILE)) fs.writeFileSync(CSV_FILE, 'fullName,email,mobile,college,city,state,createdAt\n');
	if (!fs.existsSync(EVENTS_DB)) {
		// Default event
		const defaultEvent = [{
			id: Date.now().toString(),
			title: 'Emergency Management In Ayurveda',
			description: 'Join us for an exclusive offline seminar in Bhopal designed for Ayurveda students and practitioners. Learn how to effectively bridge classical Ayurvedic wisdom with modern medical tools and diagnostic techniques.',
			date: '9th November 2025',
			venue: 'Vigyan Bhawan, MPCST',
			speaker: 'Dr. Anuj Jain',
			createdAt: new Date().toISOString()
		}];
		fs.writeFileSync(EVENTS_DB, JSON.stringify(defaultEvent, null, 2));
	}
}

ensureDataFiles();

// Helpers
function appendToCsv(row) {
	const values = [row.fullName, row.email, row.mobile, row.college, row.city, row.state, row.createdAt]
		.map(v => '"' + String(v ?? '').replace(/"/g, '""') + '"')
		.join(',');
	fs.appendFileSync(CSV_FILE, values + '\n');
}

function readJsonDb() {
	try { return JSON.parse(fs.readFileSync(JSON_DB, 'utf8') || '[]'); }
	catch { return []; }
}

function writeJsonDb(records) {
	fs.writeFileSync(JSON_DB, JSON.stringify(records, null, 2));
}

// Event management helpers
function readEventsDb() {
	try { return JSON.parse(fs.readFileSync(EVENTS_DB, 'utf8') || '[]'); }
	catch { return []; }
}

function writeEventsDb(events) {
	fs.writeFileSync(EVENTS_DB, JSON.stringify(events, null, 2));
}

// Routes
app.get('/', (req, res) => {
	const events = readEventsDb();
	res.render('index', { title: 'Shree Vishwa Asha Ayurvedic Panchakarma Centre', events });
});

// eBook access form
app.get('/ebook-access', (req, res) => {
	res.render('ebook-access', { title: 'Access eBook' });
});

app.post('/ebook-access', (req, res) => {
	const { fullName, email, mobile, college, city, state } = req.body;
	if (!fullName || !email || !mobile) {
		return res.status(400).render('ebook-access', { title: 'Access eBook', error: 'Please fill required fields.' });
	}
	const record = { fullName, email, mobile, college: college || '', city: city || '', state: state || '', createdAt: new Date().toISOString() };
	const records = readJsonDb();
	records.push(record);
	writeJsonDb(records);
	appendToCsv(record);
	req.session.canViewEbook = true;
	res.redirect('/ebook');
});

// Guarded eBook viewer
app.get('/ebook', (req, res) => {
	if (!req.session.canViewEbook) return res.redirect('/ebook-access');
	res.render('ebook', { title: 'eBook' });
});

// Admin auth
function requireAdmin(req, res, next) {
	if (req.session && req.session.isAdmin) return next();
	return res.redirect('/admin/login');
}

app.get('/admin/login', (req, res) => {
	res.render('admin-login', { title: 'Admin Login', error: null });
});

app.post('/admin/login', (req, res) => {
	const { username, password } = req.body;
	if (
		username === (process.env.ADMIN_USER || 'admin') &&
		password === (process.env.ADMIN_PASS || 'password')
	) {
		req.session.isAdmin = true;
		return res.redirect('/admin');
	}
	res.status(401).render('admin-login', { title: 'Admin Login', error: 'Invalid credentials' });
});

app.get('/admin/logout', (req, res) => {
	req.session.isAdmin = false;
	res.redirect('/admin/login');
});

app.get('/admin', (req, res) => {
    if (req.session.isAdmin) {
        const users = JSON.parse(fs.readFileSync(JSON_DB, 'utf8'));
        const events = JSON.parse(fs.readFileSync(EVENTS_DB, 'utf8'));
        res.render('admin-dashboard', { title: 'Admin Dashboard', users, events });
    } else {
        res.redirect('/admin/login');
    }
});

app.get('/admin/download-csv', requireAdmin, (req, res) => {
	res.setHeader('Content-Type', 'text/csv');
	res.setHeader('Content-Disposition', 'attachment; filename="users.csv"');
	fs.createReadStream(CSV_FILE).pipe(res);
});

app.get('/admin/download-json', requireAdmin, (req, res) => {
	res.setHeader('Content-Type', 'application/json');
	res.setHeader('Content-Disposition', 'attachment; filename="users.json"');
	const records = readJsonDb();
	res.send(JSON.stringify(records, null, 2));
});

// Event Management Routes
app.post('/admin/events/add', requireAdmin, (req, res) => {
	const { title, description, date, venue, speaker } = req.body;
	if (!title || !date || !venue) {
		return res.status(400).json({ error: 'Title, date, and venue are required' });
	}
	const events = readEventsDb();
	const newEvent = {
		id: Date.now().toString(),
		title,
		description: description || '',
		date,
		venue,
		speaker: speaker || '',
		createdAt: new Date().toISOString()
	};
	events.push(newEvent);
	writeEventsDb(events);
	res.json({ success: true, event: newEvent });
});

app.post('/admin/events/update/:id', requireAdmin, (req, res) => {
	const { id } = req.params;
	const { title, description, date, venue, speaker } = req.body;
	const events = readEventsDb();
	const index = events.findIndex(e => e.id === id);
	if (index === -1) {
		return res.status(404).json({ error: 'Event not found' });
	}
	events[index] = {
		...events[index],
		title: title || events[index].title,
		description: description !== undefined ? description : events[index].description,
		date: date || events[index].date,
		venue: venue || events[index].venue,
		speaker: speaker !== undefined ? speaker : events[index].speaker,
		updatedAt: new Date().toISOString()
	};
	writeEventsDb(events);
	res.json({ success: true, event: events[index] });
});

app.post('/admin/events/delete/:id', requireAdmin, (req, res) => {
	const { id } = req.params;
	const events = readEventsDb();
	const filtered = events.filter(e => e.id !== id);
	if (filtered.length === events.length) {
		return res.status(404).json({ error: 'Event not found' });
	}
	writeEventsDb(filtered);
	res.json({ success: true });
});

// Fallback
app.use((req, res) => res.status(404).render('404', { title: 'Not Found' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));


