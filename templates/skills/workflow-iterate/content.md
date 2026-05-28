# Workflow Iteration

Use this skill when creating or revising workflow definitions.

1. Read the existing workflow and its recent run history.
2. Identify the smallest behavior change that addresses the failure or request.
3. Keep node IDs stable unless a rename is required for clarity.
4. Declare inputs for every upstream output the downstream node reads.
5. Validate trigger schema with the platform-supported subset only: `type`, `required`, `properties`, `enum`, `const`, and `items`.
6. Run a dry-run or focused test with representative input.
7. Record the change, test result, and any remaining human decisions.
