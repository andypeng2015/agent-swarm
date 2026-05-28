import type { Metadata } from "next";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { TemplateGallery } from "@/components/template-gallery";
import { AssetGallery } from "@/components/asset-gallery";
import { getAllTemplates, getAllAssets } from "@/lib/templates";

export const metadata: Metadata = {
  title: "Browse Templates",
  description:
    "Browse pre-configured agent templates, skills, schedules, and workflows for your swarm. Ready to deploy.",
  openGraph: {
    title: "Browse Agent Swarm Templates",
    description:
      "Browse pre-configured agent templates, skills, schedules, and workflows for your swarm. Ready to deploy.",
  },
};

export default function Home() {
  const templates = getAllTemplates();
  const assets = getAllAssets();

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-12">
        <div className="mb-10 text-center">
          <h1 className="text-4xl font-bold tracking-tight">Agent Swarm Templates</h1>
          <p className="mt-4 text-lg text-muted-foreground">
            Pre-configured agents, skills, schedules, and workflows for your swarm
          </p>
        </div>

        {/* Agent templates section */}
        <section className="mb-16">
          <h2 className="text-2xl font-semibold mb-2">Agent Templates</h2>
          <p className="text-sm text-muted-foreground mb-6">
            Pre-configured worker and lead agent identities — deploy via Docker Compose or the swarm CLI.
          </p>
          <TemplateGallery templates={templates} />
        </section>

        {/* Skills, schedules & workflows section */}
        <section>
          <h2 className="text-2xl font-semibold mb-2">Skills, Schedules &amp; Workflows</h2>
          <p className="text-sm text-muted-foreground mb-6">
            Reusable automation building blocks — install skills, schedule recurring tasks, or wire up multi-agent workflows.
          </p>
          <AssetGallery assets={assets} />
        </section>
      </main>
      <Footer />
    </div>
  );
}
