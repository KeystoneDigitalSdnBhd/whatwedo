/**
 * Keystone Sovereign Agent (`ks_sovereign_91a`) — Master Switchboard
 * Entities:
 *  - Keystone Intelligence Global (PG0591671-U) | https://keystoneinsights.org
 *  - Keystone Digital Sdn. Bhd. (1694093-U | TIN C61137449080 | D-U-N-S 473316744 | DuitNow 9999001236666) | https://keystonedigital.com.my
 *  - Keystone Insights Corp. (Delaware 10778512 | LEI 254900MUEU3Z26I2OM74) | https://keystoneinsights.xyz
 * AI Ambassador: Kaito (LINE @494zhezf | IG/X/FB @keystonekaito)
 */

import fs from 'node:fs';
import path from 'node:path';

export interface KeystoneEntityMetadata {
  ideasVault: {
    name: string;
    ssm: string;
    domain: string;
  };
  operatingHub: {
    name: string;
    ssm: string;
    tin: string;
    duns: string;
    duitnowQrId: string;
    hqAddress: string;
    domain: string;
    appleTeamId: string;
    bundleId: string;
    playDevId: string;
  };
  globalUsdRail: {
    name: string;
    delawareFileNo: string;
    lei: string;
    domain: string;
  };
}

export const KEYSTONE_ENTITIES: KeystoneEntityMetadata = {
  ideasVault: {
    name: "Keystone Intelligence Global",
    ssm: "202603209774 (PG0591671-U)",
    domain: "https://keystoneinsights.org",
  },
  operatingHub: {
    name: "Keystone Digital Sdn. Bhd.",
    ssm: "202601031998 (1694093-U)",
    tin: "C61137449080",
    duns: "473316744",
    duitnowQrId: "9999001236666",
    hqAddress: "Level 22, Suite 015, Presint Menara Merdeka 118, 50118 Kuala Lumpur",
    domain: "https://keystonedigital.com.my",
    appleTeamId: "U5FML334GJ",
    bundleId: "com.keystonedigital",
    playDevId: "8308321417735488168",
  },
  globalUsdRail: {
    name: "Keystone Insights Corp.",
    delawareFileNo: "10778512",
    lei: "254900MUEU3Z26I2OM74",
    domain: "https://keystoneinsights.xyz",
  },
};

export type AIEngineType =
  | "byteplus-modelark"
  | "ytl-ilmu"
  | "gemini-pro"
  | "alibaba-qwen"
  | "meta-muse"
  | "huawei-kunpeng";

export interface AIEngineConfig {
  id: AIEngineType;
  name: string;
  baseUrl: string;
  activeModels: string[];
}

export const AI_ENGINES: Record<AIEngineType, AIEngineConfig> = {
  "byteplus-modelark": {
    id: "byteplus-modelark",
    name: "BytePlus ModelArk Studio (ap-southeast-1)",
    baseUrl: process.env.ARK_BASE_URL || "https://ark.ap-southeast.bytepluses.com/api/v3",
    activeModels: [
      "seedance-2-5-pro",
      "seedream-5-0-pro",
      "seed-2-0-pro",
      "doubao-embedding-vision",
      "hyper3d-gen2",
    ],
  },
  "ytl-ilmu": {
    id: "ytl-ilmu",
    name: "YTL ILMU Sovereign 70B & Vision",
    baseUrl: process.env.YTL_ILMU_BASE_URL || "https://api.ilmu.ytl.ai/v1",
    activeModels: ["ilmu-70b-sovereign", "ilmu-vision-v2"],
  },
  "gemini-pro": {
    id: "gemini-pro",
    name: "Google Gemini 2.5 Pro",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    activeModels: ["gemini-2.5-pro", "gemini-2.5-flash"],
  },
  "alibaba-qwen": {
    id: "alibaba-qwen",
    name: "Alibaba Cloud Qwen Sovereign",
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    activeModels: ["qwen-max", "qwen-plus", "qwen-vl-max"],
  },
  "meta-muse": {
    id: "meta-muse",
    name: "Meta LLaMA & Muse Suite",
    baseUrl: "https://api.meta-cloud.ai/v1",
    activeModels: ["llama-3.3-70b-instruct", "meta-muse-creative"],
  },
  "huawei-kunpeng": {
    id: "huawei-kunpeng",
    name: "Huawei Cloud Kunpeng AI Hub",
    baseUrl: "https://modelarts-infer.myhuaweicloud.com/v1",
    activeModels: ["pangu-alpha", "kunpeng-vision"],
  },
};

export interface IntelligenceTool {
  name: string;
  provider: string;
  category_region: string;
  auth: string;
  base_url: string;
  docs_url: string;
  description: string;
}

export interface IntelligenceDirectory {
  schema_version: string;
  title: string;
  sovereign_agent: string;
  entity: string;
  total_sheets: number;
  total_tools: number;
  sheets: Record<string, IntelligenceTool[]>;
}

export class KeystoneIntelligenceSwitchboard {
  private directory: IntelligenceDirectory | null = null;

  constructor() {
    this.loadDirectory();
  }

  private loadDirectory(): void {
    const candidates = [
      path.resolve(process.cwd(), "config/intelligence-api-directory.json"),
      path.resolve(process.cwd(), "KeystoneDigitalSdnBhd/whatwedo/config/intelligence-api-directory.json"),
      "/home/antigravity/KeystoneDigitalSdnBhd/whatwedo/config/intelligence-api-directory.json",
      "/shared/user/.gemini/skills/keystone-sovereign-agent/references/intelligence-api-directory.json",
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        try {
          this.directory = JSON.parse(fs.readFileSync(p, "utf8"));
          break;
        } catch (e) {
          // continue
        }
      }
    }
  }

  public getDirectory(): IntelligenceDirectory | null {
    if (!this.directory) this.loadDirectory();
    return this.directory;
  }

  public listSheets(): string[] {
    const d = this.getDirectory();
    return d ? Object.keys(d.sheets) : [];
  }

  public searchTools(keyword: string): Array<{ sheet: string; tool: IntelligenceTool }> {
    const d = this.getDirectory();
    if (!d) return [];
    const q = keyword.toLowerCase();
    const results: Array<{ sheet: string; tool: IntelligenceTool }> = [];

    for (const [sheet, tools] of Object.entries(d.sheets)) {
      for (const tool of tools) {
        if (
          tool.name.toLowerCase().includes(q) ||
          tool.provider.toLowerCase().includes(q) ||
          tool.description.toLowerCase().includes(q)
        ) {
          results.push({ sheet, tool });
        }
      }
    }
    return results;
  }
}

export interface PartnerProvisionRequest {
  slug: string;
  companyName: string;
  brn: string; // 12-digit SSM BRN
  address: string;
  contactEmail: string;
  whatsappNumber: string;
}

export interface PartnerProvisionResult {
  status: "provisioned" | "failed";
  partnerSlug: string;
  stack: {
    byteplusGeneration: { status: string; models: string[] };
    vercelEdgeCdn: { status: string; domain: string; headers: Record<string, string> };
    lhdnMyInvois: { status: string; tin: string; duitnowQr: string };
    googleMaps: { status: string; geocodedPremise: string };
    appleMdmProfile: { status: string; downloadUrl: string };
    whatsappBusiness: { status: string; channel: string };
  };
}

export class KeystonePartnerRetentionFlywheel {
  static provision(req: PartnerProvisionRequest): PartnerProvisionResult {
    return {
      status: "provisioned",
      partnerSlug: req.slug,
      stack: {
        byteplusGeneration: {
          status: "ready",
          models: ["seedance-2-5-pro", "seedream-5-0-pro", "seed-2-0-pro"],
        },
        vercelEdgeCdn: {
          status: "edge-cached",
          domain: `https://${req.slug}.keystonedigital.com.my`,
          headers: {
            "X-Keystone-CDN": "vercel-global-edge",
            "X-Keystone-Agent": "ks_sovereign_91a",
          },
        },
        lhdnMyInvois: {
          status: "pre-wired",
          tin: KEYSTONE_ENTITIES.operatingHub.tin,
          duitnowQr: KEYSTONE_ENTITIES.operatingHub.duitnowQrId,
        },
        googleMaps: {
          status: "geocoded",
          geocodedPremise: req.address || KEYSTONE_ENTITIES.operatingHub.hqAddress,
        },
        appleMdmProfile: {
          status: "generated",
          downloadUrl: `/api/v1/partner/mdm-profile/${req.slug}.mobileconfig`,
        },
        whatsappBusiness: {
          status: "bridged",
          channel: req.whatsappNumber || "@keystonekaito",
        },
      },
    };
  }
}

export const sovereignSwitchboard = new KeystoneIntelligenceSwitchboard();
