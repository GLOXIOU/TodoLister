# 📋 TodoLister

**Tired of juggling Notion, Trello, and a sticky note app all at once?**  
Stop the chaos — TodoLister is your all-in-one project manager built *by developers, for developers*.

**TodoLister** is a self-hosted Trello-like project manager with per-project kanban boards, notes, statuses, visibility controls, and fine-grained permission sharing — all running on your own machine with MySQL and Node.js.

---

## ✨ Features

* 🗂️ **Project dashboard** — See all your projects at a glance, create new ones with name, description, repo link & more
* 📌 **Project statuses** — Mark projects as *In Development*, *To Fix*, *In Production*, or any custom status
* 🗒️ **Notes per project** — Quick notepad attached to each project
* 🎯 **Kanban boards** — Drag-and-drop cards across *Backend*, *Frontend*, and *Other* categories (fully customizable)
* 🃏 **Card statuses** — *To Develop*, *Idea*, *To Fix*, *Done* — hide/show any status or category on the fly
* 🔒 **IP whitelist** — Define trusted IPs in `.env`; anyone else hits a hard block on the entire service
* 👁️ **Public / Private projects** — Share a project publicly with a password; control exactly what guests can do
* 🛡️ **Guest permissions** — Full editor, card-only mover, or read-only observer — you decide per project
* ⚡ **Lightweight stack** — MySQL + Node.js + vanilla HTML/CSS/JS, no bloat

## 📦 Installation

### 1. Clone the repository

```bash
git clone https://github.com/GLOXIOU/todolister.git
cd todolister
```

### 2. Set up MySQL

Make sure MySQL is running, then create the database and run the schema:

```bash
mysql -u root -p
```

```sql
CREATE DATABASE todolister;
EXIT;
```

```bash
mysql -u root -p todolister < schema.sql
```

> The `schema.sql` file at the root of the project contains all the tables needed. Run it once on first install.

### 3. Create your `.env` file

```bash
cp .env.example .env
```

Then edit `.env` with your values:

```env
# Server
PORT=3000

# MySQL connection
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_mysql_password_here
DB_NAME=todolister

# IP Whitelist (comma-separated, supports CIDR notation)
# Anyone NOT in this list will be blocked from the entire service
ALLOWED_IPS=127.0.0.1,192.168.1.0/24

# Session secret (change this to something random!)
SESSION_SECRET=change_me_to_something_random_and_long
```

### 4. Install dependencies

```bash
npm install
```

### 5. Start the project

```bash
npm start
```

Or in development mode with auto-reload:

```bash
npm run dev
```

The app will be available at `http://localhost:3000` (or whatever port you set).

---

## 🔒 Security & Access Control

### IP Whitelist

TodoLister uses a strict IP whitelist defined in your `.env`. If a request comes from an IP **not** in `ALLOWED_IPS`, the user sees a hard block page and cannot access **anything** — not even the login screen.

### Guest Permissions (Public Projects)

You can share a projet to another developper ! When sharing a public project, the project owner defines a **share password** and sets a **guest permission level**:

| Permission Level | What the guest can do |
|------------------|-----------------------|
| 👁️ **Observer**    | View only — no interactions |
| 🖱️ **Card Mover**  | Drag and reorder cards, but cannot edit content |
| ✏️ **Full Editor** | Move cards, edit card content, manage categories |

The project owner can change or revoke guest permissions at any time, and can also flip the project back to Private instantly, and the other develloper IP don't need to be in the .env file.

---

## 🧾 License

© GLOXIOU