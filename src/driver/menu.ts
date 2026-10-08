import type { ContextMenu } from "@drawdy/driver-protocol";
import type { Action } from "./context.ts";

const GROUP_COUNTS = [3, 4, 5, 6, 8] as const;

/** Shown under Drawdy's "Extension" submenu on right-click. */
export const MENU: ContextMenu = {
    menuId: "sensemaker",
    menuTitle: "Sensemaker",
    children: [
        { menuId: "sensemaker:cluster", menuTitle: "Group by meaning" },
        {
            menuId: "sensemaker:cluster-into",
            menuTitle: "Group into…",
            children: GROUP_COUNTS.map((k) => ({ menuId: `sensemaker:cluster:${k}`, menuTitle: `${k} groups` })),
        },
        { menuId: "sensemaker:similar", menuTitle: "Find similar" },
        { menuId: "sensemaker:open", menuTitle: "Search by meaning…" },
    ],
};

/** The clickable entries: those without children. */
export const leafIds = (menu: ContextMenu): string[] =>
    menu.children?.length ? menu.children.flatMap(leafIds) : [menu.menuId];

export const actionForMenu = (menuId: string): Action | null => {
    const k = /^sensemaker:cluster:(\d+)$/.exec(menuId)?.[1];
    if (k) return { type: "cluster", k: Number(k) };
    switch (menuId) {
        case "sensemaker:cluster":
            return { type: "cluster" };
        case "sensemaker:similar":
            return { type: "similar" };
        case "sensemaker:open":
            return { type: "open-panel" };
        default:
            return null;
    }
};
