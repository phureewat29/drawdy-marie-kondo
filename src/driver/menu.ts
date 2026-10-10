import type { ContextMenu } from "@drawdy/driver-protocol";
import type { Action } from "./context.ts";

/** Shown under Drawdy's "Extension" submenu on right-click. */
export const MENU: ContextMenu = {
    menuId: "janitor",
    menuTitle: "Janitor",
    children: [
        { menuId: "janitor:cluster", menuTitle: "Group by meaning" },
        { menuId: "janitor:similar", menuTitle: "Find similar" },
        { menuId: "janitor:open", menuTitle: "Search by meaning…" },
    ],
};

/** The clickable entries: those without children. */
export const leafIds = (menu: ContextMenu): string[] =>
    menu.children?.length ? menu.children.flatMap(leafIds) : [menu.menuId];

export const actionForMenu = (menuId: string): Action | null => {
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
