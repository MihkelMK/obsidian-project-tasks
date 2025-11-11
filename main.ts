import {App, Editor, MarkdownFileInfo, MarkdownView, Plugin, PluginSettingTab, Setting, TextComponent, TFolder, TAbstractFile, AbstractInputSuggest} from 'obsidian';
import Helper, {DEFAULT_SETTINGS, Nestingbehavior, PrefixMethod, ProjectTasksSettings} from "./helpers";
import {editor} from "./test/basic_tests";

// Folder suggestion component for autocomplete
class FolderSuggest extends AbstractInputSuggest<TFolder> {
    constructor(app: App, private inputEl: HTMLInputElement) {
        super(app, inputEl);
    }

    getSuggestions(inputStr: string): TFolder[] {
        const abstractFiles = this.app.vault.getAllLoadedFiles();
        const folders: TFolder[] = [];
        const lowerCaseInputStr = inputStr.toLowerCase();

        abstractFiles.forEach((folder: TAbstractFile) => {
            if (folder instanceof TFolder && folder.path.toLowerCase().contains(lowerCaseInputStr)) {
                folders.push(folder);
            }
        });

        return folders;
    }

    renderSuggestion(folder: TFolder, el: HTMLElement): void {
        el.setText(folder.path);
    }

    selectSuggestion(folder: TFolder): void {
        this.inputEl.value = folder.path;
        this.inputEl.trigger("input");
        this.close();
    }
}

// Turn on to allow debugging in the console
const DEBUG = false;


export default class ProjectTasks extends Plugin {
    settings: ProjectTasksSettings;

    private originalSaveCallback: ((checking: boolean) => boolean) | undefined;

    async onload() {
        if (DEBUG) console.log('Project Tasks starting');

        await this.loadSettings();
        this.setupSaveHandler();

        this.addCommand({
            id: "set-ids",
            name: "Set project ids on selection",
            editorCallback: (editor, view) => {
                let sel = editor.getSelection();
                let lines = Helper.addTaskIDs(sel, Helper.getPrefix(editor, this.getFilename(editor, view), this.getFileSettings(editor)), this.getFileSettings(editor).automaticTagNames, this.getFileSettings(editor).nestedTaskBehavior == Nestingbehavior.ParallelExecution, this.getFileSettings(editor).idPrefixMethod == PrefixMethod.UsePrefix, this.getFileSettings(editor).randomIDLength, this.getFileSettings(editor).sequentialStartNumber);
                editor.replaceSelection(
                    `${lines}`
                );
            }
        });

        this.addCommand({
            id: "set-ids-block",
            name: "Set project ids on block",
            editorCallback: (editor, view) => {
                Helper.blockUpdate(editor, this.getFilename(editor, view), true, this.getFileSettings(editor));
            }
        })

        this.addCommand({
            id: "set-ids-file",
            name: "Set project ids on entire file",
            editorCallback: (editor, view) => {
                Helper.addIDsToFile(editor, this.getFilename(editor, view), this.getFileSettings(editor));
            }
        })


        this.addCommand({
            id: "add-project-task-list",
            name: "Add active project task list",
            editorCallback: (editor, view) => {
                this.addActiveProjectList(editor);
            }
        })

        this.addCommand({
            id: "clear-ids",
            name: "Clear project ids on selection",
            editorCallback: (editor, view) => {
                let sel = editor.getSelection();
                let lines = Helper.clearBlockIDs(sel, this.getFileSettings(editor).automaticTagNames, this.getFileSettings(editor).clearAllTags);
                editor.replaceSelection(
                    `${lines}`
                );
            }
        });

        this.addCommand({
            id: "clear-ids-block",
            name: "Clear project ids on block",
            editorCallback: (editor, view) => {
                Helper.blockUpdate(editor, this.getFilename(editor, view), false, this.getFileSettings(editor));
            }
        })

        this.addCommand({
            id: "clear-ids-file",
            name: "Clear project ids in entire file",
            editorCallback: (editor, view) => {
                let sel = editor.getValue();
                let lines = Helper.clearBlockIDs(sel, this.getFileSettings(editor).automaticTagNames, this.getFileSettings(editor).clearAllTags);
                editor.setValue(lines);
            }
        })

        // This adds a settings tab so the user can configure various aspects of the plugin
        this.addSettingTab(new ProjectTasksSettingsTab(this.app, this));

    }

    addActiveProjectList(editor: Editor) {
        // A view to show active tasks
        const active_tasks_view = `\`\`\`tasks
tags includes #${this.getFileSettings(editor).automaticTagNames}
not done
hide backlink
is not blocked
\`\`\``;
        editor.replaceSelection(active_tasks_view);
    }

    getFileSettings(editor: Editor) {
        // Returns the local settings for the file
        // This is the main settings for the plug in plus any override from the 
        // file front matter
        if (this.settings.overrideSettings) {
            return Helper.getSettingsFromFrontMatter(editor, this.settings);
        } else {
            return this.settings;
        }
    }

    getFilename(editor: Editor, view: MarkdownFileInfo) {
        if (!view.file?.name) {
            return this.getFileSettings(editor).projectPrefix;
        } else {
            return view.file.name.split('.')[0];
        }
    }

    setupSaveHandler() {
        const saveCommandDefinition = (this.app as any).commands?.commands?.['editor:save-file'];
        this.originalSaveCallback = saveCommandDefinition?.checkCallback;

        if (typeof this.originalSaveCallback === 'function') {
            const plugin = this;
            saveCommandDefinition.checkCallback = (checking: boolean) => {
                if (checking) {
                    return plugin.originalSaveCallback!(checking);
                }

                // Run our auto-update logic before saving
                if (plugin.settings.autoUpdateOnSave) {
                    const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
                    if (view && view.file) {
                        const filePath = view.file.path;
                        if (plugin.isFileInWatchedFolder(filePath)) {
                            const editor = view.editor;
                            Helper.blockUpdate(editor, plugin.getFilename(editor, view), true, plugin.getFileSettings(editor));
                        }
                    }
                }

                // Then call original save
                plugin.originalSaveCallback!(checking);
                return false;
            };
        }
    }

    isFileInWatchedFolder(filePath: string): boolean {
        if (this.settings.watchedFolders.length === 0) {
            return false; // No folders specified - file can not be watched
        }

        for (const folder of this.settings.watchedFolders) {
            // Normalize folder path
            const normalizedFolder = folder.endsWith('/') ? folder : folder + '/';
            if (filePath.startsWith(normalizedFolder) || filePath.startsWith(folder)) {
                return true;
            }
        }

        return false;
    }

    onunload() {
        // Restore original save callback
        if (this.originalSaveCallback) {
            const saveCommandDefinition = (this.app as any).commands?.commands?.['editor:save-file'];
            if (saveCommandDefinition) {
                saveCommandDefinition.checkCallback = this.originalSaveCallback;
            }
        }
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}


class ProjectTasksSettingsTab extends PluginSettingTab {
    plugin: ProjectTasks;

    constructor(app: App, plugin: ProjectTasks) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const {containerEl} = this;

        containerEl.empty();

        new Setting(containerEl)
            .setName('Project ID method')
            .setDesc('Choose how the ID will be determined')
            .addDropdown(dropDown => {
                dropDown.addOption('1', 'Use prefix');
                dropDown.addOption('2', 'Use Section name');
                dropDown.addOption('3', 'Use filename')
                    .setValue(this.plugin.settings.idPrefixMethod.toString())
                    .onChange(async (value) => {
                        this.plugin.settings.idPrefixMethod = parseInt(value) as PrefixMethod;
                        await this.plugin.saveSettings();
                    })
            });

        new Setting(containerEl)
            .setName('Project ID prefix')
            .setDesc('Prefix to use when creating an ID for a task')
            .addText(text => text
                .setPlaceholder('ID prefix')
                .setValue(this.plugin.settings.projectPrefix)
                .onChange(async (value) => {
                    this.plugin.settings.projectPrefix = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Length of random ID number')
            .setDesc('How many digits to use for random ID when using a fixed prefix')
            .addSlider(text => text
                .setValue(this.plugin.settings.randomIDLength)
                .setLimits(3, 6, 1)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.randomIDLength = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Initial sequential ID number')
            .setDesc('Start number for sequential ID\'s')
            .addSlider(text => text
                .setValue(this.plugin.settings.sequentialStartNumber)
                .setLimits(0, 1, 1)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.sequentialStartNumber = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Remove vowels')
            .setDesc('Remove vowels from the prefix when getting from the filename or block name')
            .addToggle(text => text
                .setValue(this.plugin.settings.removeVowels)
                .onChange(async (value) => {
                    this.plugin.settings.removeVowels = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('First letter of words')
            .setDesc('Only use the first letter of words to form the prefix')
            .addToggle(text => text
                .setValue(this.plugin.settings.firstLettersOfWords)
                .onChange(async (value) => {
                    this.plugin.settings.firstLettersOfWords = value;
                    await this.plugin.saveSettings();
                }));


        new Setting(containerEl)
            .setName('Automatically add tags')
            .setDesc('A list of tags (one per line) to add to each task - do not include the # symbol')
            .addTextArea((text) => {
                text.inputEl.setAttr("rows", 5);
                text.inputEl.addClass("settings_area");
                text.setValue(this.plugin.settings.automaticTagNames.join('\n'))
                    .onChange((value) => {
                        this.plugin.settings.automaticTagNames = value.split('\n').filter(line => line.trim() !== '');
                        this.plugin.saveSettings();
                    }).then(textArea => {
                });
            });

        new Setting(containerEl)
            .setName('Clear all tags from project tasks')
            .setDesc('When clearing tags from project tasks clear all existing tags not just the automatically added ones')
            .addToggle(text => text
                .setValue(this.plugin.settings.clearAllTags)
                .onChange(async (value) => {
                    this.plugin.settings.clearAllTags = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Nested tags behavior')
            .setDesc('Determines whether nested tags will create parallel execution tags or sequential')
            .addDropdown(dropDown => {
                dropDown.addOption('1', 'Parallel Execution');
                dropDown.addOption('2', 'Sequential Execution')
                    .setValue(this.plugin.settings.nestedTaskBehavior.toString())
                    .onChange(async (value) => {
                        this.plugin.settings.nestedTaskBehavior = parseInt(value) as Nestingbehavior;
                        await this.plugin.saveSettings();
                    })
            });

        new Setting(containerEl)
            .setName('Override settings from file front matter')
            .setDesc('Allow overriding the plugin main settings by reading values from the front matter')
            .addToggle(text => text
                .setValue(this.plugin.settings.overrideSettings)
                .onChange(async (value) => {
                    this.plugin.settings.overrideSettings = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Auto-update on save')
            .setDesc('Automatically run "Set project ids on block" when saving files in watched folders')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoUpdateOnSave)
                .onChange(async (value) => {
                    this.plugin.settings.autoUpdateOnSave = value;
                    await this.plugin.saveSettings();
                    this.display(); // Refresh to show/hide folder settings
                }));

        // Show watched folders setting only if auto-update on save is turned on
        if (this.plugin.settings.autoUpdateOnSave) {
            new Setting(containerEl)
                .setName('Watched folders')
                .setDesc('Files in these folders will be auto-updated on save')
                .setHeading();

            // List existing watched folders
            this.plugin.settings.watchedFolders.forEach((folder, index) => {
                const folderEl = new Setting(containerEl)
                    .setName(folder)
                    .addButton(button => button
                        .setButtonText('Remove')
                        .setWarning()
                        .onClick(async () => {
                            this.plugin.settings.watchedFolders.splice(index, 1);
                            await this.plugin.saveSettings();
                            this.display(); // Refresh the display
                        }));

                folderEl.nameEl.style.setProperty("font-size", "var(--font-ui-small)");
                
                if (index > 0) {
                    folderEl.settingEl.style.setProperty("border-top", "none");
                    folderEl.settingEl.style.setProperty("padding-top", "0.25em");
                };
            });

            // Add new folder input
            let textComponent: TextComponent;
            new Setting(containerEl)
                .setName('Add folder')
                .setDesc('Enter folder path (e.g., "Projects" or "Work/Tasks")')
                .addText(text => {
                    textComponent = text;
                    text.setPlaceholder('Folder path...')
                        .onChange(() => {
                            // Validate folder exists
                            const value = text.getValue().trim();
                            if (value) {
                                const folder = this.app.vault.getAbstractFileByPath(value);
                                if (folder instanceof TFolder) {
                                    text.inputEl.style.borderColor = 'var(--interactive-success)';
                                } else {
                                    text.inputEl.style.borderColor = 'var(--interactive-accent)';
                                }
                            } else {
                                text.inputEl.style.borderColor = '';
                            }
                        });
                    // Add folder autocomplete
                    new FolderSuggest(this.app, text.inputEl);
                })
                .addButton(button => button
                    .setButtonText('Add')
                    .setCta()
                    .onClick(async () => {
                        const folderPath = textComponent.getValue().trim();
                        if (folderPath && !this.plugin.settings.watchedFolders.includes(folderPath)) {
                            this.plugin.settings.watchedFolders.push(folderPath);
                            await this.plugin.saveSettings();
                            this.display(); // Refresh the display
                        }
                    }))
                .settingEl.style.setProperty("border-top", "none");
        }

    }
}

