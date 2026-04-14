import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const metaRes = await fetch("https://api.hyperliquid.xyz/info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "metaAndAssetCtxs" }),
    });

    const metaData = await metaRes.json() as [
      { universe: { name: string; szDecimals: number }[] },
      { funding: string; openInterest: string; markPx: string }[]
    ];

    const universe = metaData[0].universe;
    const assetCtxs = metaData[1];

    const rates = universe.map((asset, i) => ({
      coin: asset.name,
      fundingRate: parseFloat(assetCtxs[i]?.funding ?? "0"),
      openInterest: parseFloat(assetCtxs[i]?.openInterest ?? "0"),
    }));

    const annualised = rates.map((r) => ({
      ...r,
      annualisedRate: r.fundingRate * 24 * 365,
    })).sort((a, b) => b.annualisedRate - a.annualisedRate);

    const byOI = [...rates].sort((a, b) => b.openInterest - a.openInterest).slice(0, 20);
    const topOIRates = byOI.map((r) => r.fundingRate * 24 * 365);
    const sorted = [...topOIRates].sort((a, b) => a - b);
    const medianTopRate = sorted[Math.floor(sorted.length / 2)];

    let regime: "HOT" | "NEUTRAL" | "COLD";
    if (medianTopRate > 0.20) {
      regime = "HOT";
    } else if (medianTopRate > 0.08) {
      regime = "NEUTRAL";
    } else {
      regime = "COLD";
    }

    const topPair = annualised[0];
    const confidence = computeConfidence(medianTopRate, regime);

    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
    return res.status(200).json({
      regime,
      topPair: topPair.coin,
      annualizedFunding: parseFloat(topPair.annualisedRate.toFixed(4)),
      medianTopOIFunding: parseFloat(medianTopRate.toFixed(4)),
      confidence,
      timestamp: Date.now(),
    });
  } catch (err) {
    console.error("Regime API error:", err);
    return res.status(500).json({ error: "Failed to compute regime" });
  }
}

function computeConfidence(medianRate: number, regime: "HOT" | "NEUTRAL" | "COLD"): number {
  if (regime === "HOT") {
    return Math.min((medianRate - 0.20) / 0.30, 1.0);
  } else if (regime === "NEUTRAL") {
    const distFromCentre = Math.abs(medianRate - 0.14) / 0.06;
    return Math.max(1 - distFromCentre, 0.1);
  } else {
    return Math.min((0.08 - medianRate) / 0.08, 1.0);
  }
}
