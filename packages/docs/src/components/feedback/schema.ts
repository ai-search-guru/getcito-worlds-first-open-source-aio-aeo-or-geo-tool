export interface PageFeedback {
	opinion: "good" | "bad";
	message: string;
	url: string;
}

export interface BlockFeedback {
	blockId: string;
	blockBody?: string;
	message: string;
	url: string;
}

export interface ActionResponse {
	success: boolean;
}
