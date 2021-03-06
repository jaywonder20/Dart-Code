import * as path from "path";
import { CancellationToken, CodeLens, CodeLensProvider, commands, Event, EventEmitter, Range, TextDocument } from "vscode";
import { FlutterSdks, IAmDisposable, Logger } from "../../shared/interfaces";
import { fsPath } from "../../shared/utils/fs";
import { LspClassOutlineVisitor } from "../../shared/utils/outline_lsp";
import { envUtils, lspToPosition, lspToRange } from "../../shared/vscode/utils";
import { LspAnalyzer } from "../analysis/analyzer_lsp";

const dartPadSamplePattern = new RegExp("\\{@tool\\s+dartpad");

export class LspFlutterDartPadSamplesCodeLensProvider implements CodeLensProvider, IAmDisposable {
	private disposables: IAmDisposable[] = [];
	private onDidChangeCodeLensesEmitter: EventEmitter<void> = new EventEmitter<void>();
	public readonly onDidChangeCodeLenses: Event<void> = this.onDidChangeCodeLensesEmitter.event;
	private readonly flutterPackagesFolder: string;

	constructor(private readonly logger: Logger, private readonly analyzer: LspAnalyzer, private readonly sdks: FlutterSdks) {
		this.disposables.push(this.analyzer.fileTracker.onOutline.listen((_) => {
			this.onDidChangeCodeLensesEmitter.fire();
		}));

		this.disposables.push(commands.registerCommand("_dart.openDartPadSample", async (sample: DartPadSampleInfo) => {
			// Link down to first code snippet.
			const fragment = `#${sample.libraryName}.${sample.className}.1`;
			const url = `https://api.flutter.dev/flutter/${sample.libraryName}/${sample.className}-class.html${fragment}`;
			await envUtils.openInBrowser(url);
		}));

		this.flutterPackagesFolder = path.join(sdks.flutter, "packages/flutter/lib/src/").toLowerCase();
	}

	public provideCodeLenses(document: TextDocument, token: CancellationToken): CodeLens[] | undefined {
		// Ensure this file is a Flutter package file.
		const filePath = fsPath(document.uri);
		if (!filePath.toLowerCase().startsWith(this.flutterPackagesFolder))
			return;

		// This method should be FAST because it affects layout of the document (adds extra lines) so if
		// we don't already have an outline, we won't wait for one. A new outline arriving will trigger a
		// re-request anyway.
		const outline = this.analyzer.fileTracker.getOutlineFor(document.uri);
		if (!outline || !outline.children || !outline.children.length)
			return;

		const libraryName = filePath.substr(this.flutterPackagesFolder.length).replace("\\", "/").split("/")[0];

		const visitor = new LspClassOutlineVisitor(this.logger);
		visitor.visit(outline);

		// Filter classes to those with DartPad samples.
		const samples = visitor.classes.filter((cl) => {
			// HACK: DartDocs are between the main offset and codeOffset.
			const docs = document.getText(new Range(lspToPosition(cl.range.start), lspToPosition(cl.codeRange.start)));
			return dartPadSamplePattern.test(docs);
		}).map((cl) => ({ ...cl, libraryName }));

		return samples
			.filter((sample) => sample.codeRange)
			.map((sample) => new CodeLens(
				lspToRange(sample.codeRange),
				{
					arguments: [sample],
					command: "_dart.openDartPadSample",
					title: `Open online interactive samples for ${sample.className}`,
				},
			));
	}

	public dispose(): any {
		this.disposables.forEach((d) => d.dispose());
	}
}

export interface DartPadSampleInfo {
	libraryName: string;
	className: string;
	offset: number;
	length: number;
}
