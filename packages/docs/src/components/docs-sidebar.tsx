"use client";

import { useState } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { ChevronRight, Search } from "lucide-react";
import { cn } from "@workspace/ui/lib/utils";
import type { Root, Node, Item, Folder } from "fumadocs-core/page-tree";
import { SearchDialog, useSearchDialog } from "./search-dialog";

function SidebarItem({ item }: { item: Item }) {
	const location = useLocation();
	const active = location.pathname === item.url;

	return (
		<Link
			to={item.url}
			className={cn(
				"block rounded-md px-3 py-1.5 text-sm transition-colors",
				active
					? "bg-primary/10 font-medium text-primary"
					: "text-muted-foreground hover:bg-muted hover:text-foreground",
			)}
		>
			{item.name}
		</Link>
	);
}

function SidebarFolder({ folder }: { folder: Folder }) {
	const location = useLocation();
	const isActive = folder.children.some(
		(child) =>
			(child.type === "page" && location.pathname === child.url) ||
			(child.type === "folder" &&
				child.children.some(
					(c) => c.type === "page" && location.pathname === c.url,
				)),
	);
	const [open, setOpen] = useState(
		folder.defaultOpen ?? isActive ?? false,
	);

	return (
		<div className="pt-3 first:pt-0">
			<button
				type="button"
				onClick={() => setOpen(!open)}
				className="flex w-full items-center gap-1.5 px-3 py-1 text-sm font-semibold transition-colors hover:text-foreground"
			>
				<ChevronRight
					className={cn(
						"size-3 shrink-0 text-muted-foreground transition-transform",
						open && "rotate-90",
					)}
				/>
				{folder.name}
			</button>
			{open && (
				<div className="ml-3 mt-1 space-y-0.5 border-l pl-2">
					{folder.index && <SidebarItem item={folder.index} />}
					<SidebarNodes nodes={folder.children} />
				</div>
			)}
		</div>
	);
}

function SidebarNodes({ nodes }: { nodes: Node[] }) {
	return (
		<div className="space-y-0.5">
			{nodes.map((node, i) => {
				if (node.type === "page") {
					return <SidebarItem key={node.url ?? i} item={node} />;
				}
				if (node.type === "folder") {
					return <SidebarFolder key={node.$id ?? i} folder={node} />;
				}
				if (node.type === "separator") {
					if (!node.name) {
						return (
							<div
								key={node.$id ?? i}
								className="my-3 border-t"
							/>
						);
					}
					return (
						<div
							key={node.$id ?? i}
							className="pt-5 pb-1 px-3 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/70"
						>
							{node.name}
						</div>
					);
				}
				return null;
			})}
		</div>
	);
}

export function DocsSidebar({ tree }: { tree: Root }) {
	const { open, setOpen } = useSearchDialog();

	return (
		<nav className="space-y-4">
			<button
				type="button"
				onClick={() => setOpen(true)}
				className="flex w-full items-center gap-2 rounded-md border bg-muted/50 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted"
			>
				<Search className="size-3.5 shrink-0" />
				<span className="flex-1 text-left">Search docs...</span>
				<kbd className="rounded border bg-background px-1.5 py-0.5 text-[10px] font-medium">
					⌘K
				</kbd>
			</button>
			<SearchDialog open={open} onOpenChange={setOpen} />
			<SidebarNodes nodes={tree.children} />
		</nav>
	);
}
