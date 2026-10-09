import type { ContextMenu } from "@drawdy/driver-protocol";
import type { Action } from "./context.ts";

const GROUP_COUNTS = [3, 4, 5, 6, 8] as const;

/** Shown under Drawdy's "Extension" submenu on right-click. */
export const MENU: ContextMenu = {
    menuId: "janitor",
    menuTitle: "Janitor",
    children: [
        { menuId: "janitor:cluster", menuTitle: "Group by meaning" },
        {
            menuId: "janitor:cluster-into",
            menuTitle: "Group into…",
            children: GROUP_COUNTS.map((k) => ({ menuId: `janitor:cluster:${k}`, menuTitle: `${k} groups` })),
        },
        { menuId: "janitor:similar", menuTitle: "Find similar" },
        { menuId: "janitor:open", menuTitle: "Search by meaning…" },
    ],
};

/** The clickable entries: those without children. */
export const leafIds = (menu: ContextMenu): string[] =>
    menu.children?.length ? menu.children.flatMap(leafIds) : [menu.menuId];

export const actionForMenu = (menuId: string): Action | null => {
    const k = /^janitor:cluster:(\d+)$/.exec(menuId)?.[1];
    if (k) return { type: "cluster", k: Number(k) };
    switch (menuId) {
        case "janitor:cluster":
            return { type: "cluster" };
        case "janitor:similar":
            return { type: "similar" };
        case "janitor:open":
            return { type: "open-panel" };
        default:
            return null;
    }
};
