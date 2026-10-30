# Antemortem — Privacy policy

Antemortem is an Atlassian Forge app. It runs entirely on Atlassian's Forge platform, inside the Atlassian site where it is installed.

**What it reads.** Jira work items (fields, labels, links, status, dates), Confluence pages in the configured space, and the data its users enter in the app (contracts, obligations, decisions, assumptions, availability).

**What it writes.** Confluence pages in the configured space (projected and averted incidents), Jira issues in the configured project (corrective actions), one issue property (`antemortem`) on demo issues, and its own Forge SQL / Key-Value storage for the model and the forecasts.

**Where data lives.** In Forge-hosted storage provisioned per installation, in the Atlassian region of the site. The app has no external egress: nothing is sent to any server outside Atlassian. No language model is called by the engine.

**Personal data.** Atlassian account IDs and display names appear where Jira exposes them (assignees, reporters) and in the availability records users create. They are used only to compute forecasts and to name people in the generated documents. Nothing is used for profiling or shared with third parties.

**Retention and deletion.** Data is deleted with the installation when the app is uninstalled, in accordance with the Forge storage lifecycle. The demo scenario can be removed at any time with *Reset demo*.

**Contact.** Open an issue on the project repository or contact the app owner through the installation page.

*Last updated: October 2026.*
