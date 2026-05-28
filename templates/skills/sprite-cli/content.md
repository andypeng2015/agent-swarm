# Sprite CLI Sandbox

Use this skill when local execution is unsafe or unavailable.

Rules:

1. Create the smallest sandbox that can run the experiment.
2. Install only required packages inside the sandbox.
3. Copy out logs or artifacts needed for review.
4. Destroy every sandbox created for the task.
5. Never store long-lived secrets in the sandbox filesystem; use `{{SPRITES_API_KEY}}` only for authentication.
