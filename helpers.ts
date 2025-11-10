
let matter = require("gray-matter");

const BLOCK_BOUNDARY = /^#+\s/;


export enum PrefixMethod {
    UsePrefix = 1,
    SectionName = 2,
    FileName = 3
}

export enum Nestingbehavior {
    ParallelExecution = 1,
    SequentialExecution = 2,
}

export enum DependencyDirection {
    TopDown = 1,  // Children depend on parents (standard)
    BottomUp = 2, // Parents depend on children (rollup/milestone)
}

export interface ProjectTasksSettings {
    idPrefixMethod: PrefixMethod;
    projectPrefix: string;
    randomIDLength: number;
    sequentialStartNumber: number;
    removeVowels: boolean;
    firstLettersOfWords: boolean;
    automaticTagNames: string[];
    clearAllTags: boolean;
    rootTaskBehavior: Nestingbehavior;
    nestedTaskBehavior: Nestingbehavior;
    dependencyDirection: DependencyDirection;
    explicitDependencies: boolean;
    overrideSettings: boolean;
    debug: boolean;
}

export const DEFAULT_SETTINGS: ProjectTasksSettings = {
    idPrefixMethod: PrefixMethod.UsePrefix,
    projectPrefix: 'prj',
    randomIDLength: 6,
    sequentialStartNumber: 1,
    removeVowels: false,
    firstLettersOfWords: false,
    automaticTagNames: ["Project"],
    clearAllTags: false,
    rootTaskBehavior: Nestingbehavior.SequentialExecution,
    nestedTaskBehavior: Nestingbehavior.ParallelExecution,
    dependencyDirection: DependencyDirection.TopDown,
    explicitDependencies: true,
    overrideSettings: true,
    debug: false
}

interface SimpleCursor {
    line: number
    ch: number
}

interface SimpleEditor {
    // This interface is created to help with the functions here that need the Obsidian Editor
    getCursor(): SimpleCursor;
    getLine(n: number): string;
    lineCount(): number;
    getRange(start: {line: number, ch: number}, end: {line: number, ch: number}): string;
    replaceRange(text: string, start: {line: number, ch: number}, end: {line: number, ch: number}): void;
    setCursor(cursor: {line: number, ch: number}): void;
    getValue(): string;
    setValue(text: string): void;
}

interface TaskNode {
    id: string;
    index: number;  // Original order in file
    parsed: ParsedLine;
    nesting: number;
    children: TaskNode[];
    parent: TaskNode | null;
}

class ParsedLine {
    public task_prefix: string;

    constructor(public is_task: boolean, public status_type: string, public line_text: string,
                public nesting: number, public indent_string: string = '') {
        if (this.is_task) {
            this.task_prefix = `${indent_string}- [${status_type}] `;
        } else {
            this.task_prefix = '';
        }
    }

    getLineSplit(line: string) {
        return line.split(/(\s+)/);
    }

    removeAllTags() {
        return this.removeTags();
    }

    removeTags(tags_to_remove?: string[]) {
        let words = this.getLineSplit(this.line_text);
        for (let idx = 0; idx < words.length; idx++) {
            let word = words[idx];
            if (word.trim().length != 0) {
                // It is a valid tag we should be removing
                let is_valid_tag = word.startsWith('#') && (!tags_to_remove || tags_to_remove.indexOf(word.slice(1)) >= 0)
                if (is_valid_tag) {
                    // It is a tag, so do not include it and eat the previous or following whitespace
                    words[idx] = '';
                    if (idx != 0) {
                        words[idx - 1] = '';
                    } else if (idx != words.length - 1) {
                        words[idx + 1] = '';
                    }
                }
            } else {
                // This was whitespace
                if (idx == words.length - 1) {
                    // We should ignore this
                    words[idx] = '';
                }
            }
        }
        return words.join('');
    }
}

export default class Helper {
    // Simple helper class that contains the business logic
    // of the app. This is extracted here to allow unit testing
    constructor() {
    }

    static getNestingLevel(task_marker: string, tabSize: number = 4): number {
        // The nesting level is the indentation level before the first "-" character
        let parts = task_marker.replaceAll("\n", "").split("-");
        let indent = parts[0];

        // Count tabs (each tab = 1 level)
        let tabs = (indent.match(/\t/g) || []).length;
        if (tabs > 0) {
            return tabs;
        }

        // Count spaces (using the configured tab size)
        return Math.floor(indent.length / tabSize);
    }

    static generateRandomDigits(length: number): string {
      const digits = '0123456789';
      let randomString = '';

      for (let i = 0; i < length; i++) {
        const randomIndex = Math.floor(Math.random() * digits.length);
        randomString += digits[randomIndex];
      }

      return randomString;
    }

    static clearBlockIDs(sel: string, automatic_tags: string[], clear_all_tags: boolean) {
        // ToDo refactor clearBlockIDs to use settings
        // Remove existing ID's
        // Remove leading space if at end of line (before tags or end), otherwise remove trailing space
        let remove_id = / 🆔\s[\w,]+(?=\s*(?:#|$))/gm;
        sel = sel.replaceAll(remove_id, '');
        sel = sel.replaceAll(/🆔\s[\w,]+ /g, '');

        // Remove existing Blocks
        // Remove leading space if at end of line (before tags or end), otherwise remove trailing space
        let remove_block = / ⛔\s[\w,]+(?=\s*(?:#|$))/gm;
        sel = sel.replaceAll(remove_block, '');
        sel = sel.replaceAll(/⛔\s[\w,]+ /g, '');

        // Remove the tags
        let cleaned_text = [];
        for (let line of sel.split(/\r?\n/)) {
            let parsed = this.parseLine(line);
            if (parsed.is_task) {
                if (clear_all_tags) {
                    cleaned_text.push(parsed.task_prefix + parsed.removeAllTags());
                } else {
                    cleaned_text.push(parsed.task_prefix + parsed.removeTags(automatic_tags));
                }
            } else {
                cleaned_text.push(parsed.line_text);
            }
        }

        return cleaned_text.join('\n');
    }

    static getBlockEnd(editor: SimpleEditor) {
        // Find the end of the block
        let blockEnd = editor.getCursor().line;
        if (blockEnd >= editor.lineCount() - 1) return blockEnd + 1;
        blockEnd += 1;
        while (!BLOCK_BOUNDARY.test(editor.getLine(blockEnd))) {
            blockEnd++;
            if (blockEnd > editor.lineCount() - 1) return blockEnd;
        }
        return blockEnd;
    }

    static getBlockStart(editor: SimpleEditor) {
        // Find the start of the block
        let blockStart = editor.getCursor().line;
        if (BLOCK_BOUNDARY.test(editor.getLine(blockStart))) {
            return Math.min(editor.lineCount() -1, blockStart + 1);
        }
        while (blockStart > 0 && !BLOCK_BOUNDARY.test(editor.getLine(blockStart - 1))) {
            blockStart--;
        }
        return blockStart;
    }

    static getAllBlockStarts(editor: SimpleEditor) {
        // Return all the lines that mark the start of a block in a file
        let blocks = [0];
        let section = /^#?#*\s\w+/
        for (let line_number = 0; line_number < editor.lineCount(); line_number++) {
            if (section.test(editor.getLine(line_number))) {
                // Special case when the first line is a section we don't have to add it
                if (line_number > 0) {
                    blocks.push(line_number);
                }
            }
        }

        return blocks;
    }

    static getSectionName(editor: SimpleEditor, file_name: string) {
        let section_start = Helper.getBlockStart(editor);
        if (section_start == 0) {
            return file_name
        } else {
            return editor.getLine(section_start-1);
        }
    }

    static getAllDescendants(node: TaskNode): string[] {
        // Get all descendant IDs in order (depth-first traversal)
        let descendants: string[] = [];
        for (const child of node.children) {
            descendants.push(child.id);
            descendants.push(...this.getAllDescendants(child));
        }
        return descendants;
    }

    static addTaskIDs(sel: string, prefix: string, automatic_tags: string[], root_parallel: boolean, nested_parallel: boolean, bottom_up: boolean, explicit_dependencies: boolean, use_prefix: boolean,
                      random_id_length: number, sequential_start: number, debug: boolean = false, tabSize: number = 4) {
        // ToDo refactor addTaskIDs to use the settings
        // Clear all the existing block and project ID's
        sel = Helper.clearBlockIDs(sel, automatic_tags, false);

        if (debug) console.log(`Replaced ids and blocks to give: ${sel}`);

        // PASS 1: Build tree structure and assign IDs
        let tasks: TaskNode[] = [];
        let all_lines: (TaskNode | ParsedLine)[] = [];  // Mix of tasks and non-task lines
        let idx = 0;
        let parent_stack: TaskNode[] = [];  // Stack to track current parent at each nesting level

        for (const line of sel.split(/\r?\n/)) {
            let match = this.parseLine(line, tabSize);

            // Is this a task line at all?
            if (match.is_task) {
                // Get an id to use
                let this_id: string;
                if (use_prefix) {
                    this_id = `${prefix}${Helper.generateRandomDigits(random_id_length)}`;
                } else {
                    this_id = `${prefix}${idx + sequential_start}`;
                }

                // Create task node
                let task_node: TaskNode = {
                    id: this_id,
                    index: idx,
                    parsed: match,
                    nesting: match.nesting,
                    children: [],
                    parent: null
                };

                // Build parent-child relationships
                // Adjust parent stack based on nesting level
                while (parent_stack.length > 0 && parent_stack[parent_stack.length - 1].nesting >= match.nesting) {
                    parent_stack.pop();
                }

                // Set parent if we have one
                if (parent_stack.length > 0) {
                    let parent = parent_stack[parent_stack.length - 1];
                    task_node.parent = parent;
                    parent.children.push(task_node);
                }

                // Add to parent stack for potential children
                parent_stack.push(task_node);

                tasks.push(task_node);
                all_lines.push(task_node);
                idx += 1;
            } else {
                // Not a task line so just keep it as is
                all_lines.push(match);
            }
        }

        // For bottom-up: calculate which children each task should block on
        let child_blockers = new Map<string, string>();  // task_id -> comma-separated child IDs
        if (bottom_up) {
            for (const task of tasks) {
                if (task.children.length > 0) {
                    // Get all descendant IDs for this task
                    let descendant_ids = this.getAllDescendants(task);
                    child_blockers.set(task.id, descendant_ids.join(','));
                }
            }
        }

        // PASS 2: Generate output with blockers
        let lines = "";
        let first = true;
        let nesting_ids = ["0:ERROR!"];
        let current_nesting = 0;
        let is_parallel = root_parallel;
        let this_id;

        // Go through all the lines and add appropriate ID and block tags
        for (const item of all_lines) {
            if (!first) {
                lines += "\n";
            }

            // Is this a task line at all?
            if ('id' in item) {
                let task = item as TaskNode;
                let match = task.parsed;
                this_id = task.id;

                // Watch out for changes in nesting
                let nesting_depth = match.nesting;
                if (nesting_depth > current_nesting) {
                    // Add a new level of nesting
                    current_nesting += 1;
                    is_parallel = nested_parallel;
                    // Initialize new level based on mode and dependency direction:
                    // - In bottom-up mode: always start with empty string (no parent dependency)
                    // - In top-down parallel mode: empty string, siblings will be accumulated
                    // - In top-down sequential mode: use previous task as blocker for first child
                    if (bottom_up || nested_parallel) {
                        nesting_ids.push(``);
                    } else {
                        nesting_ids.push(nesting_ids[nesting_ids.length - 1]);
                    }
                } else if (nesting_depth < current_nesting) {
                    // Remove levels of nesting
                    while (current_nesting > nesting_depth) {
                        current_nesting -= 1;
                        let nested = nesting_ids.pop();
                        // Determine the new mode after decrement
                        let new_is_parallel = (current_nesting > 0) ? nested_parallel : root_parallel;

                        // Merge nested level into parent level (only for top-down mode)
                        // In bottom-up mode, each level is independent, so no merging needed
                        if (!bottom_up) {
                            if (current_nesting === 0 && root_parallel) {
                                // Exiting back to root parallel mode - clear blockers
                                nesting_ids[0] = "";
                            } else if (nested && is_parallel) {
                                // Was in parallel mode: accumulate nested IDs at parent level
                                let parent_value = nesting_ids[nesting_ids.length - 1];
                                if (parent_value && parent_value !== "0:ERROR!") {
                                    nesting_ids[nesting_ids.length - 1] += `,${nested}`;
                                } else {
                                    nesting_ids[nesting_ids.length - 1] = nested;
                                }
                            } else if (nested && !is_parallel) {
                                // Was in sequential mode: last nested task is the blocker
                                nesting_ids[nesting_ids.length - 1] = nested;
                            }
                        }
                        is_parallel = new_is_parallel;
                    }
                }
                let this_line;
                // Add the id into there
                let cleaned_line = match.line_text;
                // Add a space at the end if needed
                if (cleaned_line != "") cleaned_line += " ";
                this_line = `${match.task_prefix}${cleaned_line}🆔 ${this_id}`;

                // Add blockers based on dependency direction
                let blockers: string[] = [];

                if (bottom_up) {
                    // Bottom-up: parents depend on children
                    // Add child blockers first
                    let child_blocker = child_blockers.get(this_id);
                    if (child_blocker) {
                        blockers.push(child_blocker);
                    }
                    // Add sibling blockers (sequential mode only)
                    // Check if there's a previous sibling at the current nesting level
                    if (!is_parallel && nesting_ids[current_nesting] !== undefined && nesting_ids[current_nesting] !== "") {
                        let sibling_blocker = nesting_ids[current_nesting];
                        if (sibling_blocker !== "0:ERROR!") {
                            blockers.push(sibling_blocker);
                        }
                    }
                } else {
                    // Top-down: children depend on parents
                    if (task.index > 0) {
                        // Add the blocks after the very first task
                        if (is_parallel && current_nesting > 0) {
                            // Parallel mode: block on parent level
                            blockers.push(nesting_ids[current_nesting - 1]);
                        } else if (!is_parallel) {
                            // Sequential mode: block on previous task
                            blockers.push(nesting_ids[nesting_ids.length - 1]);
                        }
                        // else: parallel mode at root level (current_nesting=0) - no blocker
                    }
                }

                // Apply blockers to the line
                if (blockers.length > 0) {
                    this_line += ` ⛔ ${blockers.join(',')}`;
                }

                // Add an automatic tag if we need it
                for (const tag of automatic_tags) {
                    let tag_text = ` #${tag}`;
                    if (this_line.indexOf(tag_text) < 0) {
                        this_line += tag_text;
                    }
                }

                // Append this line
                lines += this_line;
                if (is_parallel) {
                    // In parallel mode, accumulate task IDs
                    let current_value = nesting_ids[nesting_ids.length - 1];
                    if (current_value && current_value !== "0:ERROR!" && current_value !== "") {
                        nesting_ids[nesting_ids.length - 1] += `,${this_id}`;
                    } else {
                        nesting_ids[nesting_ids.length - 1] = this_id;
                    }
                } else {
                    nesting_ids[nesting_ids.length - 1] = this_id;
                }
                if (debug) console.log(`Nesting level ${current_nesting}, ids ${nesting_ids}`);
            } else {
                // Not a task line so just keep it as is
                let parsed = item as ParsedLine;
                lines += parsed.line_text;
            }
            first = false;
        }
        return lines;
    }

    static blockUpdate(editor: SimpleEditor, filename: string, add_ids: boolean, settings: ProjectTasksSettings, tabSize: number = 4) {
        const prefix = this.getPrefix(editor, filename, settings);

        // Get the block boundaries
        let blockStart = Helper.getBlockStart(editor);
        let blockEnd = Helper.getBlockEnd(editor);
        let last_line_length = editor.getLine(blockEnd + 1).length;

        const blockContent = editor.getRange({line: blockStart, ch: 0}, {line: blockEnd, ch: last_line_length});
        if (settings.debug) console.log(`Start ${blockStart}, End ${blockEnd}, last length ${last_line_length}\nOrig: ${blockContent}`);

        let lines;
        if (add_ids) {
            lines = Helper.addTaskIDs(blockContent, prefix, settings.automaticTagNames,
                settings.rootTaskBehavior == Nestingbehavior.ParallelExecution,
                settings.nestedTaskBehavior == Nestingbehavior.ParallelExecution,
                settings.dependencyDirection == DependencyDirection.BottomUp,
                settings.explicitDependencies,
                settings.idPrefixMethod == PrefixMethod.UsePrefix,
                settings.randomIDLength, settings.sequentialStartNumber, settings.debug, tabSize)
        } else {
            lines = Helper.clearBlockIDs(blockContent, settings.automaticTagNames,
                settings.clearAllTags);
        }

        if (settings.debug) console.log(`Start ${blockStart}, End ${blockEnd}, last length ${last_line_length}\nOrig: ${blockContent}\nNew: ${lines}`);
        editor.replaceRange(lines, {line: blockStart, ch: 0}, {line: blockEnd, ch: last_line_length});
    }

    static addIDsToFile(editor: SimpleEditor, filename: string, settings: ProjectTasksSettings, tabSize: number = 4) {
        let initial_cursor = editor.getCursor()
        for (let block_start of this.getAllBlockStarts(editor)) {
            editor.setCursor({line: block_start, ch: 0});
            this.blockUpdate(editor, filename, true, settings, tabSize);
        }
        editor.setCursor({line: initial_cursor.line, ch: initial_cursor.ch});
    }

    static parseLine(line: string, tabSize: number = 4) {
        const regex = /^(\s*-\s\[([ x\-\/])]\s)?(.*)$/;
        let match = regex.exec(line);
        if (match) {
            // Was an expected line
            if (match[1]) {
                // This is a task line
                // Extract the indentation (everything before the dash)
                let indent_match = line.match(/^(\s*)-/);
                let indent_string = indent_match ? indent_match[1] : '';
                return new ParsedLine(true, match[2], match[3], this.getNestingLevel(line, tabSize), indent_string);
            } else {
                // This isn't a task line
                return new ParsedLine(false, '', match[3], 0, '');
            }
        } else {
            // Something went wrong here
            throw new Error(`Line was not understood: "${line}"`);
        }
    }


    static getPrefix(editor: SimpleEditor, filename: string, settings: ProjectTasksSettings) {
        let raw_prefix;
        switch (settings.idPrefixMethod) {
            case PrefixMethod.UsePrefix: {
                raw_prefix = settings.projectPrefix;
                break;
            }
            case PrefixMethod.FileName: {
                raw_prefix = filename;
                break;
            }
            case PrefixMethod.SectionName: {
                // Try to find the name of the block that contains the cursor or the selection
                raw_prefix = Helper.getSectionName(editor, filename);
            }
        }
        return Helper.getPrefixFromString(raw_prefix, settings.firstLettersOfWords, settings.removeVowels);
    }

    static getPrefixFromString(text: string, first_letters: boolean, remove_vowels: boolean) {
        // Remove any special signs
        text = text.replaceAll(/[#\[\]]/g, '');
        // Break into words
        let words = text.split(/\s+/);
        text = "";
        for (let word of words) {
            if (word) {
                text = `${text}${word[0].toUpperCase()}`;
                if (!first_letters) {
                    let remainder = word.slice(1);
                    // Remove vowels if needed
                    if (remove_vowels) {
                        remainder = remainder.replaceAll(/[aeiou]/g, '');
                    }
                    text = `${text}${remainder}`;
                }
            }
        }
        // Remove spaces
        text = text.replaceAll(' ', '');
        return text;
    }

    static getSettingsFromFrontMatter(editor: SimpleEditor, settings: ProjectTasksSettings) {
        // Get the entire text of the file
        let text = editor.getValue();
        let front_matter = matter(text);
        // Remove any bits of front matter that are not relevant
        for (const key in front_matter.data) {
            if (!settings.hasOwnProperty(key)) {
                delete front_matter.data[key];
            }
        }
        return {...settings, ...front_matter.data};
    }
}
