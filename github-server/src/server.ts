import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

app.post("/mcp", async (req, res) => {
  const { owner, repo, prNumber } = req.body;

  // GitHub diff endpoint
  const diffUrl = `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`;

  try {
    const r = await fetch(diffUrl, {
      headers: {
        Accept: "application/vnd.github.v3.diff",
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      },
    });

    const diffText = await r.text();

    return res.json({
      diff: diffText,
    });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

app.listen(4000, () => {
  console.log("github-fetcher up on 4000");
});
