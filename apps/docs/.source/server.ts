// @ts-nocheck
import * as __fd_glob_27 from "../content/docs/model-network/platform-node.mdx?collection=docs"
import * as __fd_glob_26 from "../content/docs/model-network/overview.mdx?collection=docs"
import * as __fd_glob_25 from "../content/docs/model-network/models.mdx?collection=docs"
import * as __fd_glob_24 from "../content/docs/model-network/economy.mdx?collection=docs"
import * as __fd_glob_23 from "../content/docs/model-network/distributed-node.mdx?collection=docs"
import * as __fd_glob_22 from "../content/docs/model-network/connect-model.mdx?collection=docs"
import * as __fd_glob_21 from "../content/docs/getting-started/introduction.mdx?collection=docs"
import * as __fd_glob_20 from "../content/docs/getting-started/first-call.mdx?collection=docs"
import * as __fd_glob_19 from "../content/docs/getting-started/auth.mdx?collection=docs"
import * as __fd_glob_18 from "../content/docs/getting-started/api-key.mdx?collection=docs"
import * as __fd_glob_17 from "../content/docs/community/groups.mdx?collection=docs"
import * as __fd_glob_16 from "../content/docs/community/feedback.mdx?collection=docs"
import * as __fd_glob_15 from "../content/docs/community/faq.mdx?collection=docs"
import * as __fd_glob_14 from "../content/docs/api/xllmapi-unified.mdx?collection=docs"
import * as __fd_glob_13 from "../content/docs/api/overview.mdx?collection=docs"
import * as __fd_glob_12 from "../content/docs/api/openai.mdx?collection=docs"
import * as __fd_glob_11 from "../content/docs/api/errors.mdx?collection=docs"
import * as __fd_glob_10 from "../content/docs/api/anthropic.mdx?collection=docs"
import * as __fd_glob_9 from "../content/docs/agents/opencode.mdx?collection=docs"
import * as __fd_glob_8 from "../content/docs/agents/openclaw.mdx?collection=docs"
import * as __fd_glob_7 from "../content/docs/agents/generic-openai.mdx?collection=docs"
import * as __fd_glob_6 from "../content/docs/agents/claude-code.mdx?collection=docs"
import { default as __fd_glob_5 } from "../content/docs/model-network/meta.json?collection=docs"
import { default as __fd_glob_4 } from "../content/docs/api/meta.json?collection=docs"
import { default as __fd_glob_3 } from "../content/docs/getting-started/meta.json?collection=docs"
import { default as __fd_glob_2 } from "../content/docs/community/meta.json?collection=docs"
import { default as __fd_glob_1 } from "../content/docs/agents/meta.json?collection=docs"
import { default as __fd_glob_0 } from "../content/docs/meta.json?collection=docs"
import { server } from 'fumadocs-mdx/runtime/server';
import type * as Config from '../source.config';

const create = server<typeof Config, import("fumadocs-mdx/runtime/types").InternalTypeConfig & {
  DocData: {
  }
}>({"doc":{"passthroughs":["extractedReferences"]}});

export const docs = await create.docs("docs", "content/docs", {"meta.json": __fd_glob_0, "agents/meta.json": __fd_glob_1, "community/meta.json": __fd_glob_2, "getting-started/meta.json": __fd_glob_3, "api/meta.json": __fd_glob_4, "model-network/meta.json": __fd_glob_5, }, {"agents/claude-code.mdx": __fd_glob_6, "agents/generic-openai.mdx": __fd_glob_7, "agents/openclaw.mdx": __fd_glob_8, "agents/opencode.mdx": __fd_glob_9, "api/anthropic.mdx": __fd_glob_10, "api/errors.mdx": __fd_glob_11, "api/openai.mdx": __fd_glob_12, "api/overview.mdx": __fd_glob_13, "api/xllmapi-unified.mdx": __fd_glob_14, "community/faq.mdx": __fd_glob_15, "community/feedback.mdx": __fd_glob_16, "community/groups.mdx": __fd_glob_17, "getting-started/api-key.mdx": __fd_glob_18, "getting-started/auth.mdx": __fd_glob_19, "getting-started/first-call.mdx": __fd_glob_20, "getting-started/introduction.mdx": __fd_glob_21, "model-network/connect-model.mdx": __fd_glob_22, "model-network/distributed-node.mdx": __fd_glob_23, "model-network/economy.mdx": __fd_glob_24, "model-network/models.mdx": __fd_glob_25, "model-network/overview.mdx": __fd_glob_26, "model-network/platform-node.mdx": __fd_glob_27, });