import type { ContextMenu } from "@drawdy/driver-protocol";
import type { Action } from "./context.ts";

const GROUP_COUNTS = [3, 4, 5, 6, 8] as const;

/** Shown under Drawdy's "Extension" submenu on right-click. */
export const MENU: ContextMenu = {
    menuId: "marie-kondo",
    menuTitle: "Marie Kondo",
    children: [
        { menuId: "marie-kondo:cluster", menuTitle: "Group by meaning" },
        {
            menuId: "marie-kondo:cluster-into",
            menuTitle: "Group into…",
            children: GROUP_COUNTS.map((k) => ({ menuId: `marie-kondo:cluster:${k}`, menuTitle: `${k} groups` })),
        },
        { menuId: "marie-kondo:similar", menuTitle: "Find similar" },
        { menuId: "marie-kondo:open", menuTitle: "Search by meaning…" },
    ],
};

/** The clickable entries: those without children. */
export const leafIds = (menu: ContextMenu): string[] =>
    menu.children?.length ? menu.children.flatMap(leafIds) : [menu.menuId];

export const actionForMenu = (menuId: string): Action | null => {
    const k = /^marie-kondo:cluster:(\d+)$/.exec(menuId)?.[1];
    if (k) return { type: "cluster", k: Number(k) };
    switch (menuId) {
        case "marie-kondo:cluster":
            return { type: "cluster" };
        case "marie-kondo:similar":
            return { type: "similar" };
        case "marie-kondo:open":
            return { type: "open-panel" };
        default:
            return null;
    }
};
