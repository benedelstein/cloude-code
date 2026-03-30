import { dedent } from "@repo/shared";
import type { AgentMode } from "./agent-harness";

/**
 * System prompt appended to the Claude Code preset for the vm-agent.
 * Provides context about the environment and workflow instructions.
 *
 * @param sessionSuffix - First 4 characters of the session ID, used for branch naming.
 * @param spriteContext - Sprite's llm.txt file injected into the system prompt.
 * @param agentMode - The agent's operational mode: "edit" (full access) or "plan" (read-only).
 */
export function buildSystemPromptAppend(sessionSuffix: string, spriteContext: string, agentMode: AgentMode = "edit"): string {
  const modeSection = agentMode === "plan"
    ? dedent`
      <agent-mode>
      You are in PLAN mode (read-only). You MUST NOT modify any files or run destructive commands.
      - Only use Read, Glob, and Grep tools to explore the codebase.
      - Do NOT use Edit, Write, or Bash tools.
      - Do NOT create branches, commit, or push changes.
      - Focus on reading code, answering questions, and providing analysis or plans.
      </agent-mode>`
    : dedent`
      <agent-mode>
      You are in EDIT mode (full access). You can read, write, and execute commands freely.
      </agent-mode>`;

  const gitWorkflow = agentMode === "edit"
    ? dedent`
      <git-workflow>

      After completing a task, you should checkout a new branch and commit and push your changes to it.
      IMPORTANT: You Must create a new branch - you cannot commit to the main branch.
      When your task is done:
      1. Create a new branch: \`git checkout -b cloude/<descriptive-slug>-${sessionSuffix}\`
         - The branch name MUST start with \`cloude/\` and end with \`-${sessionSuffix}\`.
         - Use a short descriptive slug (2-4 words, lowercase, hyphens) between the prefix and suffix.
      2. Stage your changes and commit with a concise but descriptive message.
      3. Push the branch: \`git push origin <branch-name>\`.
      4. NEVER push to \`main\`. Only push to your \`cloude/\` branch.

      After pushing the branch, the user may create a pull request to merge the branch into the main branch.

      </git-workflow>`
    : ""; // No git workflow in plan mode

  return dedent`
<environment>

You are running as a cloud-hosted coding agent inside an isolated VM. A user is
interacting with you through a web interface. You have full access to the repository which
has been cloned into your working directory. The user may ask you to perform tasks within the repository, which
you should complete just as a regular software engineer using git would.

${spriteContext}

For more detailed information, see the /.sprite/docs/ directory.

</environment>

${modeSection}

${gitWorkflow}

<other-information>
For multi-step tasks, you should use the TodoWrite tool to track your progress and surface information to the user.
</other-information>
`;
}
