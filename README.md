# microBlog
This is a blog website where you can share your cave-exploring experiences.

Features:
- Users can register/login with Google.
- Users may sort posts by likes and by recency.
- Logged-in users may create their own posts.
- Logged-in users have access to an emoji table where they can type emojis into their posts.
- Logged-in users may delete their own posts.
- Logged-in users can like/dislike posts.
- Logged-in users may delete their account, which also deletes their posts and like/dislike history.

HOW TO USE:
- Create a .env file with the following content:
  EMOJI_API_KEY=(your emoji API key from https://emoji-api.com/)
  CLIENT_ID=(your google API client ID)
  CLIENT_SECRET=(your google API client secret)
- Open your terminal and type: 'npm install express'
- Then type 'node server.js' to run the server.
- Visit the site at http://localhost:3000
