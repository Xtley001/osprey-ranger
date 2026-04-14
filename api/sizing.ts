import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Use same deployment — derive origin from request, not a hardcoded URL
    const host  = req.headers.host ?? "";
    const proto = host.includes("localhost") ? "http" : "https";
    const regimeUrl = `${proto}://${host}/api/regime`;

    const regimeRes  = await fetch(regimeUrl);
    const regimeData = await regimeRes.json() as {
      regime: "HOT" | "NEUTRAL" | "COLD";
      annualizedFunding: number;
      confidence: number;
    };

    const baseAllocation: Record<"HOT" | "NEUTRAL" | "COLD", number> = {
      HOT:     0.70,
      NEUTRAL: 0.40,
      COLD:    0.05,
    };

    const base = baseAllocation[regimeData.regime];
    const recommendedHlAllocationPct = base * regimeData.confidence;

    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
    return res.status(200).json({
      recommendedHlAllocationPct: parseFloat(recommendedHlAllocationPct.toFixed(4)),
      baseAllocationForRegime: base,
      confidence: regimeData.confidence,
      regime: regimeData.regime,
      timestamp: Date.now(),
    });
  } catch (err) {
    console.error("Sizing API error:", err);
    return res.status(500).json({ error: "Failed to compute sizing" });
  }
}
