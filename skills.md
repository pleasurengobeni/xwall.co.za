# User Profile for AI Agent Collaboration
# This file serves as a source of truth for the agent regarding technical capabilities, workflow, and standards.

user_profile:
  name: "[Your Name]"
  role: "Lead Product Engineer & Aesthetic Architect"
  last_updated: "2024-04-13"
  
  unique_identity_markers:
    - "Resilience & Growth: Grew from nothing to something; values hard-earned excellence and high-stakes reliability."
    - "Zero Disappointments: Has no tolerance for avoidable failures; demands bulletproof logic and execution."
    - "The 'Dress to Impress' Standard: Every deliverable must be polished, professional, and ready for the executive boardroom."
    - "The Gatekeeper: AI is an advisor; only the user has the authority to 'Push' or 'Deploy'."
    - "Minimalist Explainer: Prefers subtle comments that explain 'Why', not 'What'."
    - "Visual Maverick: Obsessed with aesthetics that 'ordinary people have never seen before'."

  core_motivation: 
    - "High-impact, high-end aesthetics that transcend standard UI kits."
    - "Human-Centered Design: Applying 'The Design of Everyday Things' (Norman) to digital interfaces."
    - "Extreme reliability: Demos must be bulletproof; deployments must be idempotent."
    - "Continuous Evolution: Always using the bleeding edge of technology; no legacy shortcuts."

  architectural_philosophy: 
    - "Terraform-First: All infrastructure must be defined as code (IaC) before service implementation."
    - "Microservices Architecture (Docker-first isolation)"
    - "Vertical Slice Architecture: Grouping by feature to prevent cross-feature 'bombing'."
    - "Strict Separation of Concerns (SoC): No SQL/DB logic in the View layer."
    - "Idempotency: All deployment and system operations must be repeatable without side effects."
    - "Clean Folder Organization: No 'everything-everywhere' files; logical, intuitive naming."
    - "Elegant Code: Architecture should be as 'tailored' and clean as the final UI."

  technical_proficiency:
    languages_and_tools:
      primary: "Python (Subtle, professional commenting style)"
      infrastructure_as_code: "Terraform / HCL"
      environment: "Linux / macOS (Local) / Docker (Containerization)"
      infrastructure: "Microservices / Docker Compose"
    
    security_standards:
      philosophy: "Zero Trust / Data Hardening / Least Privilege"
      data_security: "Strict encryption; data must be unreadable even in a breach scenario."
      access_control: "Service accounts must have strictly limited, scope-specific access (PoLP)."
      secrets_management:
        strategy: "Automated Environment-Aware Injection"
        priority_1: "GitHub Actions Secrets (Scoped to 'development' and 'production' environments)"
        priority_2: "Managed Secret Manager (if available via specific service provider)"
        priority_3: "Local Host Export (for local development ONLY, via ~/.secrets)"
        docker_implementation: "Interpolated .env files in Docker Compose (KEY=${ENV_VAR}) populated by CI/CD context."
        rule: "Automated rotation and injection via GitHub Actions based on branch target (main/dev)."
      pii_protection: "Mandatory PII scanning in CI/CD pipelines."

    workflow_and_cicd:
      platform: "GitHub (Local -> Dev -> Main)"
      gitignore_protocol: "Aggressive .gitignore for OS metadata, secrets, and local environment files."
      pre_deployment_gate: "Mandatory 'Test-First'. Pytests must pass locally before the AI suggests a push."
      ci_checks:
        - "Linting & Formatting"
        - "Terraform Security & Compliance (tfsec, checkov, or plan-scan)"
        - "PII & Hardcoded Secret Scanning (Fail-fast)"
        - "DB Safety: Hard block on destructive ops (DROP/DELETE) in production."
      automation:
        - "AI Summary: Every PR must summarize 'The Person's Intent' and impact."
        - "Contextual Secret Injection: Automated mapping of secrets based on branch merge (Main=Prod, Dev=Dev)."
      approvals_gatekeeping:
        - "Dev Branch: 1 Approval (User supercedes all/can bypass)."
        - "Main/Prod: 2 Approvals (User is final authority)."
      deployment: "Local Push -> GitHub Actions (Env Injection) -> SSH to Server -> Git Pull -> Idempotent Redeploy."

  design_standard:
    vibe: "Extraordinary aesthetics; fluid motion; high-end typography; unique UX metaphors."
    philosophy: "The Design of Everyday Things (Norman Principles)."
    key_tenets:
      - "Affordances & Signifiers: Interactions must be intuitive and discoverable."
      - "Feedback: Every action must have an immediate, clear response."
      - "Mapping: Controls should logically correspond to their effects."
      - "Constraints: System design should prevent errors before they happen."
      - "Mental Models: Design must leverage existing user familiarity to ensure zero struggle in navigation."
      - "Discoverability: Users must never struggle to find information or tools within the build."
    principle: "Unordinary look, familiar feel. Every interaction must feel expensive yet inherently logical and easy to locate."

  testing_and_stability:
    frameworks: "Pytest / Unittest / Playwright"
    methodologies:
      - "Atomic Module-Test Pairs: A module does not exist without its corresponding test file."
      - "Synthetic Data Generation: Mandatory Positive, Negative, and Edge-Case dummy data."
      - "Regression Mitigation: AI must perform 'Dependency Impact Analysis' before proposing fixes."

# AI Guidance:
# 1. Prioritize the 'Wow' Factor: Aim for 'unordinary' design and high-end polish. Everything should be 'presentation-ready'.
# 2. Human-Centered Logic: Use Norman's principles (signifiers, feedback, mapping) to ensure 'unordinary' designs remain usable.
# 3. Discoverability First: Ensure critical actions and data are easily locatable. Leverage familiar icons, placements, and workflows to reduce cognitive load.
# 4. Consultative Growth & Proactive Advice: 
#    - If the user suggests an outdated method, AI MUST advise on the latest modern alternative.
#    - If a logic path leads to failure or 'disappointment', AI MUST flag it.
# 5. Command Authority: Never assume deployment rights. Wait for user SSH/Push commands.
# 6. Terraform-First: Propose IaC configuration and scoped service accounts before service logic.
# 7. Atomic Verification: No module is complete without a passing test.
# 8. Separation of Concerns: Hard enforcement. Business logic belongs in services/repositories, not views.
# 9. Documentation: Focus on the 'Why'.
# 10. Security: Assume breach capability; design data to be unreadable.
# 11. Environment Awareness: When building deployment scripts, assume automated secret injection via GitHub environments.
# 12. The Reveal: Summarize work as an executive presentation—highlighting stability, security, and Norman-aligned UX.