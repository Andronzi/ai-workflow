/*
curl -X POST http://localhost:3002/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "sender": "github-webhook",
    "target": "code-reviewer",
    "type": "code-review",
    "payload": {
      "diff": "diff --git a/auth.ts b/auth.ts\nindex abc123..def456 100644\n--- a/auth.ts\n+++ b/auth.ts\n@@ -1,25 +1,35 @@\n import { Request, Response } from 'express';\n+import bcrypt from 'bcrypt';\n+import jwt from 'jsonwebtoken';\n \n-export async function login(req: Request, res: Response) {\n-  const user = await db.findUser(req.body.email);\n+const JWT_SECRET = process.env.JWT_SECRET || '\''secret'\'';\n \n-  if (!user) {\n-    return res.send(\"User not found\");\n-  }\n+export async function login(req: Request, res: Response): Promise<void> {\n+  try {\n+    const { email, password } = req.body;\n+    \n+    if (!email || !password) {\n+      res.status(400).json({ error: '\''Email and password required'\'' });\n+      return;\n+    }\n \n-  if (user.password === req.body.password) {\n-    return res.send(\"ok\");\n+    const user = await db.findUser(email);\n+    \n+    if (!user) {\n+      res.status(401).json({ error: '\''Invalid credentials'\'' });\n+      return;\n+    }\n+\n+    const isValid = await bcrypt.compare(password, user.hashedPassword);\n+    \n+    if (!isValid) {\n+      res.status(401).json({ error: '\''Invalid credentials'\'' });\n+      return;\n+    }\n+\n+    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '\''24h'\'' });\n+    res.json({ token });\n+  } catch (error) {\n+    console.error('\''Login error:'\'', error);\n+    res.status(500).json({ error: '\''Internal server error'\'' });\n   }\n }",
      "context": {
        "repository": "my-awesome-app",
        "pullRequest": {
          "id": 123,
          "title": "Improve authentication security",
          "author": "developer123",
          "url": "https://github.com/my-org/my-awesome-app/pull/123"
        },
        "files": {
          "auth.ts": {
            "language": "typescript",
            "purpose": "Authentication logic",
            "securityLevel": "high",
            "previousReviewComments": [
              {
                "id": 1,
                "comment": "Avoid storing plain text passwords",
                "status": "fixed"
              }
            ]
          }
        },
        "requirements": {
          "must": [
            "Use bcrypt for password hashing",
            "Implement JWT tokens",
            "Add input validation",
            "Return proper HTTP status codes"
          ],
          "should": [
            "Add rate limiting",
            "Implement refresh tokens"
          ],
          "mustNot": [
            "Log sensitive data",
            "Store passwords in plain text"
          ]
        },
        "relatedFiles": [
          "models/User.ts",
          "middleware/authMiddleware.ts",
          "config/db.ts"
        ]
      }
    },
    "traceId": "pr-123-review-001",
    "timestamp": "2024-01-15T10:30:00Z"
  }'
*/
