const express = require('express');
const expressHandlebars = require('express-handlebars');
const session = require('express-session');
const {createCanvas, loadImage} = require('canvas');
const sqlite = require('sqlite');
const sqlite3 = require('sqlite3').verbose();
// const passport = require('passport');
const { google } = require('googleapis');
const { OAuth2Client } = require('google-auth-library');
const path = require('path');
const bcrypt = require('bcrypt');
require('dotenv').config();

const accessToken = process.env.EMOJI_API_KEY;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = 'http://localhost:3000/auth/google/callback';
const client = new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// Configuration and Setup
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

const app = express();
const PORT = 3000;

let db;

async function initializeDB() {
    const db = await sqlite.open({ filename: 'microblog.db', driver: sqlite3.Database });

    await db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            hashedGoogleId TEXT NOT NULL UNIQUE,
            avatar_url TEXT,
            memberSince DATETIME NOT NULL
        );

        CREATE TABLE IF NOT EXISTS posts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            username TEXT NOT NULL,
            timestamp DATETIME NOT NULL,
            likes INTEGER NOT NULL,
            dislikes INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS likes (
            userId INTEGER,
            postId INTEGER,
            PRIMARY KEY (userId, postId),
            FOREIGN KEY (userId) REFERENCES users(id),
            FOREIGN KEY (postId) REFERENCES posts(id)
        );

        CREATE TABLE IF NOT EXISTS dislikes (
            userId INTEGER,
            postId INTEGER,
            PRIMARY KEY (userId, postId),
            FOREIGN KEY (userId) REFERENCES users(id),
            FOREIGN KEY (postId) REFERENCES posts(id)
        );
    `);
}

initializeDB();

async function initializeDatabase() {
    db = await sqlite.open({ filename: 'microblog.db', driver: sqlite3.Database });
}

initializeDatabase().catch(err => {
    console.error('Failed to initialize database:', err);
});

app.engine(
    'handlebars',
    expressHandlebars.engine({
        helpers: {
            toLowerCase: function (str) {
                return str.toLowerCase();
            },
            ifCond: function (v1, v2, options) {
                if (v1 === v2) {
                    return options.fn(this);
                }
                return options.inverse(this);
            },
        },
    })
);

app.set('view engine', 'handlebars');
app.set('views', './views');

//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// Middleware
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

app.use(
    session({
        secret: 'oneringtorulethemall',     // Secret key to sign the session ID cookie
        resave: false,                      // Don't save session if unmodified
        saveUninitialized: false,           // Don't create session until something stored
        cookie: { secure: false },          // True if using https. Set to false for development without https
    })
);

// Replace any of these variables below with constants for your application. These variables
// should be used in your template files. 
// 
app.use((req, res, next) => {
    res.locals.appName = 'Echo';
    res.locals.copyrightYear = 2024;
    res.locals.postNeoType = 'Post';
    res.locals.loggedIn = req.session.loggedIn || false;
    res.locals.userId = req.session.userId || '';
    next();
});

app.use(express.static('public'));                  // Serve static files
app.use(express.urlencoded({ extended: true }));    // Parse URL-encoded bodies (as sent by HTML forms)
app.use(express.json());                            // Parse JSON bodies (as sent by API clients)

//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// Routes
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

// Home route: render home view with posts and user
// We pass the posts and user variables into the home
// template
//

app.get('/', async (req, res) => {
    const sort = req.query.sort || 'recent';  // Get the sort parameter from the query string, default to 'recent'
    const posts = await getPosts(sort);  // Pass the sort parameter to the getPosts function
    const user = await getCurrentUser(req) || {};
    console.log("CURRENT USER: ", await getCurrentUser(req));
    res.render('home', { posts, user, accessToken });
});

// Function to get all posts, sorted by latest first
let posts;

async function getPosts(sort = 'recent') {
    let posts;
    if (sort === 'likes') {
        posts = await db.all('SELECT * FROM posts ORDER BY likes DESC');
    } else if (sort === 'leastLikes') {
        posts = await db.all('SELECT * FROM posts ORDER BY likes');
    } else if (sort === 'recent') {
        posts = await db.all('SELECT * FROM posts ORDER BY timestamp DESC');
    } else if (sort === 'old') {
        posts = await db.all('SELECT * FROM posts ORDER BY timestamp');
    }
    return posts;
}


// Register GET route is used for error response from registration
//
app.get('/register', (req, res) => {
    res.render('loginRegister', { regError: req.query.error });
});

// Login route GET route is used for error response from login
//
app.get('/login', (req, res) => {
    res.render('loginRegister', { loginError: req.query.error });
});

app.get('/registerUsername', (req, res) => {
    res.render('registerUsername', { regError: req.query.error });
});
// Error route: render error page
//
app.get('/error', (req, res) => {
    res.render('error');
});

// Additional routes that you must implement
app.get('/post/:id', async (req, res) => {
    const post = await db.get('SELECT * FROM posts WHERE id = ?', [parseInt(req.params.id)]);
    if (post) {
        res.render('postDetail', { post });
    } else {
        res.redirect('/error');
    }
});

app.post('/posts', isAuthenticated, async (req, res) => {
    const {title, content} = req.body;
    const user = await getCurrentUser(req);
    console.log(await getCurrentUser(req));
    await addPost(title, content, user);
    res.redirect('/');
});

app.post('/like/:id', isAuthenticated, (req, res) => {
    updatePostLikes(req, res);
});
app.post('/dislike/:id', isAuthenticated, (req, res) => {
    updatePostDislikes(req, res);
});
app.get('/profile', isAuthenticated, async (req, res) => {
    await renderProfile(req, res);
});
app.get('/avatar/:username', async (req, res) => {
    const username = req.params.username;
    const user = await findUserByUsername(username);

    if (user) {
        const avatarBuffer = await generateAvatar(username.charAt(0));
        res.set('Content-Type', 'image/png');
        res.send(avatarBuffer);
    } else {
        res.status(404).send('User not found');
    }
});

app.post('/registerUsername', async (req, res) => {
    await registerUser(req, res);
});
app.get('/logout', (req, res) => {
    logoutUser(req, res);

});
app.post('/delete/:id', isAuthenticated, async (req, res) => {
    posts = await getPosts();
    const postId = parseInt(req.params.id);
    console.log("POST ID", postId);
    const postIndex = posts.findIndex(p => p.id === postId);
    posts.splice(postIndex, 1);
    await db.run('DELETE FROM posts WHERE id = ?', [postId]);
    console.log(await db.all('SELECT * FROM posts'));
    res.redirect('/');
});

app.post('/delete-account', isAuthenticated, async (req, res) => {
    const userId = req.session.userId;
    const user = await findUserById(userId);
        const username = user.username;
            //Get the post IDs that the user liked
            const likedPostIds = await db.all('SELECT postId FROM likes WHERE userId = ?', [userId]);
            for (const likedPost of likedPostIds) {
                const postId = likedPost.postId;
                console.log(`Decrementing likes for post ${postId}`);
                await db.run('UPDATE posts SET likes = likes - 1 WHERE id = ?', [postId]);
            }

            //Get the post IDs that the user disliked
            const dislikedPostIds = await db.all('SELECT postId FROM dislikes WHERE userId = ?', [userId]);
            for (const dislikedPost of dislikedPostIds) {
                const postId = dislikedPost.postId;
                console.log(`Decrementing dislikes for post ${postId}`);
                await db.run('UPDATE posts SET dislikes = dislikes - 1 WHERE id = ?', [postId]);
            }

            //Delete user's account
            await db.run('DELETE FROM users WHERE id = ?', [userId]);
            //Delete their posts
            await db.run('DELETE FROM posts WHERE username = ?', [username]);
            //Delete likes and dislikes associated with the user's account
            await db.run('DELETE FROM likes WHERE userId = ?', [userId]);
            await db.run('DELETE FROM dislikes WHERE userId = ?', [userId]);

            req.session.destroy(); 
            res.redirect('/login');
});




//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// Server Activation
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});

//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// Support Functions and Variables
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

// Function to find a user by username
async function findUserByUsername(username) {
    return await db.get('SELECT * FROM users WHERE username = ?', [username]);
}

// Function to find a user by user ID
async function findUserById(userId) {
    return await db.get('SELECT * FROM users WHERE id = ?', [parseInt(userId)]);
}


// Function to add a new user
async function addUser(username, id) {
    const newUser={
        username: username,
        hashedGoogleId: id,
        avatar_url: '',
        memberSince: new Date().toISOString().slice(0, 10) + " " + new Date().toISOString().slice(11,16)
    };
    return await db.run(
        'INSERT INTO users (username, hashedGoogleId, avatar_url, memberSince) VALUES (?, ?, ?, ?)',
            [newUser.username, newUser.hashedGoogleId, newUser.avatar_url, newUser.memberSince]
    )
}

// Middleware to check if user is authenticated
async function isAuthenticated(req, res, next) {
    console.log(req.session.userId);
    if (req.session.userId) {
        next();
    } else {
        res.redirect('/login');
    }
}

// Function to register a user
async function registerUser(req, res) {
    const username = req.body.username;
    console.log("Attempting to register:", username);
    if (await findUserByUsername(username)) {
        // Username is taken
        console.log(username, "is already taken");
        res.redirect('/registerUsername?error=Username+already+exists');
    } else {
        await addUser(username, hashedGoogleID);
        console.log(await db.all('SELECT * FROM users'));
        const user = await db.get('SELECT * FROM users WHERE username = ?', [username]);
        console.log(user);
        req.session.userId = user.id;
        console.log("CURRENT SESSION ID", req.session.userId);
        console.log("CURRENT USER ID 2: ", await findUserById(req.session.userId));
        req.session.loggedIn = true;
        res.redirect('/');
    }
}

// Redirect to Google's OAuth 2.0 server
app.get('/auth/google', (req, res) => {
    const url = client.generateAuthUrl({
        access_type: 'offline',
        scope: ['https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/userinfo.profile'],
    });
    res.redirect(url);
});

let userinfo;
let hashedGoogleID;

async function compareHashedGoogleIDs(users, GoogleID1) {
    for (const user of users) {
        console.log("user.hashedGoogleId: ", user.hashedGoogleId);
        const isMatch = await bcrypt.compare(GoogleID1, user.hashedGoogleId); // compare each hashed id
        console.log("IsMatch: ", isMatch);
        if (isMatch) {
            return user.hashedGoogleId;
        }
    }
}

// Handle OAuth 2.0 server response
app.get('/auth/google/callback', async (req, res) => {
    const { code } = req.query;
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    const oauth2 = google.oauth2({
        auth: client,
        version: 'v2',
    });

    userinfo = await oauth2.userinfo.get();
    const googleID = userinfo.data.id;
    hashedGoogleID = await bcrypt.hash(googleID, 10);

    try { // if id exists, redirect to home
        const users = await db.all('SELECT * FROM users');
        const matchedHashedGoogleID = await compareHashedGoogleIDs(users, googleID);
        const user = await db.get('SELECT * FROM users WHERE hashedGoogleId = ?', [matchedHashedGoogleID]);
        req.session.userId = user.id;
        req.session.loggedIn = true;
        res.redirect('/');
    } catch (error) { // if id does not exist, redirect to register username page
        res.redirect('/registerUsername');
    }
});

// Function to logout a user
function logoutUser(req, res) {
    req.session.destroy(err => {
        if (err) {
            console.error('Error destorying session:', err);
            res.redirect('/error');
        } else {
            res.redirect('/');
        }
    });
}

// Function to render the profile page
async function renderProfile(req, res) {
    const user = await getCurrentUser(req);
    if (!user) {
        res.redirect('/login');
        return;
    }
    try {
        const userPosts = (await getPosts()).filter(post => post.username === user.username);
        console.log(userPosts);
        res.render('profile', { user, posts: userPosts });
    } catch (err) {
        console.error('Error fetching posts:', err);
        res.redirect('/error');
    }
}


// Function to update post likes
async function updatePostLikes(req, res) {
    const postId = parseInt(req.params.id);
    const userId = req.session.userId;

    // Check if user already liked the post
    const existingDislike = await db.get('SELECT * FROM dislikes WHERE userId = ? AND postId = ?', [userId, postId]);
    const existingLike = await db.get('SELECT * FROM likes WHERE userId = ? AND postId = ?', [userId, postId]);
    if (existingLike) {
        await db.run('UPDATE posts SET likes = likes - 1 WHERE id = ?', [postId]);
        await db.run('DELETE FROM likes WHERE userId = ? AND postId = ?', [userId, postId]);
        let post = await db.get('SELECT * FROM posts WHERE id = ?', [postId]);
        let likes = post.likes;
        let dislikes = post.dislikes;
        res.json({ success: true, likes: likes, dislikes: dislikes, existingLike: false, existingDislike: false })
    } else {
        if (existingDislike) {
            await db.run('UPDATE posts SET dislikes = dislikes - 1 WHERE id = ?', [postId]);
            await db.run('DELETE FROM dislikes WHERE userId = ? AND postId = ?', [userId, postId])
        }
        // If user hasn't liked the post yet, increment the likes and record the like
        await db.run('UPDATE posts SET likes = likes + 1 WHERE id = ?', [postId]);
        await db.run('INSERT INTO likes (userId, postId) VALUES (?, ?)', [userId, postId]);

        let post = await db.get('SELECT * FROM posts WHERE id = ?', [postId]);
        let likeCount = post.likes;
        let dislikeCount = post.dislikes;

        res.json({ success: true, likes: likeCount, dislikes: dislikeCount, existingLike: true, existingDislike: false })
    }
}

async function updatePostDislikes(req, res) {
    const postId = parseInt(req.params.id);
    const userId = req.session.userId;

    const existingDislike = await db.get('SELECT * FROM dislikes WHERE userId = ? AND postId = ?', [userId, postId]);
    const existingLike = await db.get('SELECT * FROM likes WHERE userId = ? AND postId = ?', [userId, postId]);
    if (existingDislike) {
        await db.run('UPDATE posts SET dislikes = dislikes - 1 WHERE id = ?', [postId]);
        await db.run('DELETE FROM dislikes WHERE userId = ? AND postId = ?', [userId, postId]);
        let post = await db.get('SELECT * FROM posts WHERE id = ?', [postId]);
        let dislikes = post.dislikes;
        let likes = post.likes;
        res.json({ success: true, dislikes: dislikes, likes: likes, existingLike: false, existingDislike: false })
    } else {
        if (existingLike) {
            await db.run('UPDATE posts SET likes = likes - 1 WHERE id = ?', [postId]);
            await db.run('DELETE FROM likes WHERE userId = ? AND postId = ?', [userId, postId])
        }
        // If user hasn't liked the post yet, increment the likes and record the like
        await db.run('UPDATE posts SET dislikes = dislikes + 1 WHERE id = ?', [postId]);
        await db.run('INSERT INTO dislikes (userId, postId) VALUES (?, ?)', [userId, postId]);

        let post = await db.get('SELECT * FROM posts WHERE id = ?', [postId]);
        let likeCount = post.likes;
        let dislikeCount = post.dislikes;

        res.json({ success: true, likes: likeCount, dislikes: dislikeCount, existingLike: false, existingDislike: true })
    }
}



// Function to get the current user from session
async function getCurrentUser(req) {
    return await findUserById(req.session.userId);
}

// Function to add a new post
async function addPost(title, content, user) {
    const newPost = {
        title: title,
        content: content,
        username: user.username,
        timestamp: new Date().toISOString().slice(0, 10) + " " + new Date().toISOString().slice(11, 16),
        likes: 0,
        dislikes: 0,
    };
    return await db.run(
        'INSERT INTO posts (title, content, username, timestamp, likes, dislikes) VALUES (?, ?, ?, ?, ?, ?)',
            [newPost.title, newPost.content, newPost.username, newPost.timestamp, newPost.likes, newPost.dislikes]
    )
}

// Function to generate an image avatar
async function generateAvatar(letter, width = 70, height = 70) {
    const colorPalette = ['blue', 'purple', 'red', 'green', 'skyblue', 'pink', 'gold'];
    const backgroundColor = colorPalette[letter.charCodeAt(0) % colorPalette.length];
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d'); 
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = 'white';
    ctx.font = `${width / 2}px "montserrat"`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(letter.toUpperCase(), width / 2, height / 2);

    return canvas.toBuffer('image/png');
}