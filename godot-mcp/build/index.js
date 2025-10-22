#!/usr/bin/env node
/**
 * Battlefield 6 Portal MCP Server
 *
 * This MCP server provides tools for interacting with the Battlefield Portal SDK
 * in addition to general Godot engine automation. It enables AI assistants to
 * launch the Godot editor, run projects, export Portal spatial data, inspect SDK
 * resources, and orchestrate project generation workflows.
 */
import { fileURLToPath } from 'url';
import { join, dirname, basename, normalize } from 'path';
import { existsSync, readdirSync, mkdirSync, readFileSync } from 'fs';
import { spawn, execFile, exec } from 'child_process';
import { promisify } from 'util';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError, } from '@modelcontextprotocol/sdk/types.js';
// Check if debug mode is enabled
const DEBUG_MODE = process.env.DEBUG === 'true';
const GODOT_DEBUG_MODE = true; // Always use GODOT DEBUG MODE
const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
// Derive __filename and __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
/**
 * Main server class for the Battlefield 6 Portal MCP server
 */
class GodotServer {
    server;
    activeProcess = null;
    godotPath = null;
    operationsScriptPath;
    validatedPaths = new Map();
    strictPathValidation = false;
    portalSdkPath = null;
    portalProjectPath = null;
    fbExportDataPath = null;
    pythonCommand = null;
    initialConfig;
    /**
     * Parameter name mappings between snake_case and camelCase
     * This allows the server to accept both formats
     */
    parameterMappings = {
        'project_path': 'projectPath',
        'scene_path': 'scenePath',
        'root_node_type': 'rootNodeType',
        'parent_node_path': 'parentNodePath',
        'node_type': 'nodeType',
        'node_name': 'nodeName',
        'texture_path': 'texturePath',
        'node_path': 'nodePath',
        'output_path': 'outputPath',
        'mesh_item_names': 'meshItemNames',
        'new_path': 'newPath',
        'file_path': 'filePath',
        'directory': 'directory',
        'recursive': 'recursive',
        'scene': 'scene',
    };
    /**
     * Reverse mapping from camelCase to snake_case
     * Generated from parameterMappings for quick lookups
     */
    reverseParameterMappings = {};
    constructor(config) {
        this.initialConfig = config;
        // Initialize reverse parameter mappings
        for (const [snakeCase, camelCase] of Object.entries(this.parameterMappings)) {
            this.reverseParameterMappings[camelCase] = snakeCase;
        }
        // Apply configuration if provided
        let debugMode = DEBUG_MODE;
        let godotDebugMode = GODOT_DEBUG_MODE;
        if (config) {
            if (config.debugMode !== undefined) {
                debugMode = config.debugMode;
            }
            if (config.godotDebugMode !== undefined) {
                godotDebugMode = config.godotDebugMode;
            }
            if (config.strictPathValidation !== undefined) {
                this.strictPathValidation = config.strictPathValidation;
            }
            // Store and validate custom Godot path if provided
            if (config.godotPath) {
                const normalizedPath = normalize(config.godotPath);
                this.godotPath = normalizedPath;
                this.logDebug(`Custom Godot path provided: ${this.godotPath}`);
                // Validate immediately with sync check
                if (!this.isValidGodotPathSync(this.godotPath)) {
                    console.warn(`[SERVER] Invalid custom Godot path provided: ${this.godotPath}`);
                    this.godotPath = null; // Reset to trigger auto-detection later
                }
            }
            if (config.portalSdkPath) {
                this.portalSdkPath = normalize(config.portalSdkPath);
                this.logDebug(`Custom Portal SDK path provided: ${this.portalSdkPath}`);
            }
            if (config.portalProjectPath) {
                this.portalProjectPath = normalize(config.portalProjectPath);
                this.logDebug(`Custom Portal project path provided: ${this.portalProjectPath}`);
            }
            if (config.fbExportDataPath) {
                this.fbExportDataPath = normalize(config.fbExportDataPath);
                this.logDebug(`Custom Portal FbExportData path provided: ${this.fbExportDataPath}`);
            }
            if (config.pythonPath) {
                this.pythonCommand = config.pythonPath;
                this.logDebug(`Custom Python command provided: ${this.pythonCommand}`);
            }
        }
        // Attempt to resolve Portal SDK paths immediately so defaults are available
        this.detectPortalPaths();
        // Set the path to the operations script
        this.operationsScriptPath = join(__dirname, 'scripts', 'godot_operations.gd');
        if (debugMode)
            console.debug(`[DEBUG] Operations script path: ${this.operationsScriptPath}`);
        // Initialize the MCP server
        this.server = new Server({
            name: 'bf6-portal-mcp-server',
            version: '0.2.0',
        }, {
            capabilities: {
                tools: {},
            },
        });
        // Set up tool handlers
        this.setupToolHandlers();
        // Error handling
        this.server.onerror = (error) => console.error('[MCP Error]', error);
        // Cleanup on exit
        process.on('SIGINT', async () => {
            await this.cleanup();
            process.exit(0);
        });
    }
    /**
     * Log debug messages if debug mode is enabled
     */
    logDebug(message) {
        if (DEBUG_MODE) {
            console.debug(`[DEBUG] ${message}`);
        }
    }
    /**
     * Create a standardized error response with possible solutions
     */
    createErrorResponse(message, possibleSolutions = []) {
        // Log the error
        console.error(`[SERVER] Error response: ${message}`);
        if (possibleSolutions.length > 0) {
            console.error(`[SERVER] Possible solutions: ${possibleSolutions.join(', ')}`);
        }
        const response = {
            content: [
                {
                    type: 'text',
                    text: message,
                },
            ],
            isError: true,
        };
        if (possibleSolutions.length > 0) {
            response.content.push({
                type: 'text',
                text: 'Possible solutions:\n- ' + possibleSolutions.join('\n- '),
            });
        }
        return response;
    }
    /**
     * Validate a path to prevent path traversal attacks
     */
    validatePath(path) {
        // Basic validation to prevent path traversal
        if (!path || path.includes('..')) {
            return false;
        }
        // Add more validation as needed
        return true;
    }
    /**
     * Determine if a path is absolute, supporting both POSIX and Windows formats
     */
    isAbsolutePath(path) {
        if (!path) {
            return false;
        }
        return path.startsWith('/') || path.startsWith('res://') || /^[A-Za-z]:[\\/]/.test(path);
    }
    /**
     * Convert a path to an absolute path using a base directory
     */
    toAbsolutePath(basePath, targetPath) {
        if (!targetPath) {
            return targetPath;
        }
        if (targetPath.startsWith('res://')) {
            const relativePath = targetPath.replace('res://', '');
            return normalize(join(basePath, relativePath));
        }
        if (this.isAbsolutePath(targetPath)) {
            return normalize(targetPath);
        }
        return normalize(join(basePath, targetPath));
    }
    /**
     * Synchronous validation for constructor use
     * This is a quick check that only verifies file existence, not executable validity
     * Full validation will be performed later in detectGodotPath
     * @param path Path to check
     * @returns True if the path exists or is 'godot' (which might be in PATH)
     */
    isValidGodotPathSync(path) {
        try {
            this.logDebug(`Quick-validating Godot path: ${path}`);
            return path === 'godot' || existsSync(path);
        }
        catch (error) {
            this.logDebug(`Invalid Godot path: ${path}, error: ${error}`);
            return false;
        }
    }
    /**
     * Validate if a Godot path is valid and executable
     */
    async isValidGodotPath(path) {
        // Check cache first
        if (this.validatedPaths.has(path)) {
            return this.validatedPaths.get(path);
        }
        try {
            this.logDebug(`Validating Godot path: ${path}`);
            // Check if the file exists (skip for 'godot' which might be in PATH)
            if (path !== 'godot' && !existsSync(path)) {
                this.logDebug(`Path does not exist: ${path}`);
                this.validatedPaths.set(path, false);
                return false;
            }
            // Try to execute Godot with --version flag
            const command = path === 'godot' ? 'godot --version' : `"${path}" --version`;
            await execAsync(command);
            this.logDebug(`Valid Godot path: ${path}`);
            this.validatedPaths.set(path, true);
            return true;
        }
        catch (error) {
            this.logDebug(`Invalid Godot path: ${path}, error: ${error}`);
            this.validatedPaths.set(path, false);
            return false;
        }
    }
    /**
     * Attempt to detect the Portal SDK root and related directories
     */
    detectPortalPaths(config = this.initialConfig) {
        const candidateRoots = [];
        const addCandidate = (candidate) => {
            if (candidate) {
                const normalized = normalize(candidate);
                if (!candidateRoots.includes(normalized)) {
                    candidateRoots.push(normalized);
                }
            }
        };
        if (!this.portalSdkPath && config?.portalSdkPath) {
            addCandidate(config.portalSdkPath);
        }
        else if (this.portalSdkPath) {
            addCandidate(this.portalSdkPath);
        }
        if (process.env.PORTAL_SDK_PATH) {
            addCandidate(process.env.PORTAL_SDK_PATH);
        }
        if (!this.portalProjectPath && config?.portalProjectPath) {
            this.portalProjectPath = normalize(config.portalProjectPath);
        }
        if (!this.portalProjectPath && process.env.PORTAL_PROJECT_PATH) {
            this.portalProjectPath = normalize(process.env.PORTAL_PROJECT_PATH);
        }
        if (!this.fbExportDataPath && config?.fbExportDataPath) {
            this.fbExportDataPath = normalize(config.fbExportDataPath);
        }
        if (!this.fbExportDataPath && process.env.PORTAL_FB_EXPORT_PATH) {
            this.fbExportDataPath = normalize(process.env.PORTAL_FB_EXPORT_PATH);
        }
        const searchDirs = [process.cwd(), __dirname, dirname(__dirname)];
        for (const dir of searchDirs) {
            const resolved = this.resolvePortalSdkRootFrom(dir);
            if (resolved) {
                addCandidate(resolved);
            }
        }
        for (const candidate of candidateRoots) {
            if (this.isValidPortalSdkRoot(candidate)) {
                if (!this.portalSdkPath || this.portalSdkPath !== candidate) {
                    this.logDebug(`Detected Portal SDK path: ${candidate}`);
                }
                this.portalSdkPath = candidate;
                break;
            }
        }
        if (this.portalSdkPath) {
            const projectCandidate = normalize(join(this.portalSdkPath, 'GodotProject'));
            if (!this.portalProjectPath && existsSync(join(projectCandidate, 'project.godot'))) {
                this.portalProjectPath = projectCandidate;
                this.logDebug(`Detected Portal project path: ${this.portalProjectPath}`);
            }
            const fbCandidate = normalize(join(this.portalSdkPath, 'SDK', 'deps', 'FbExportData'));
            if (!this.fbExportDataPath && existsSync(fbCandidate)) {
                this.fbExportDataPath = fbCandidate;
                this.logDebug(`Detected Portal FbExportData path: ${this.fbExportDataPath}`);
            }
        }
        if (this.portalProjectPath) {
            this.portalProjectPath = normalize(this.portalProjectPath);
        }
        if (this.fbExportDataPath) {
            this.fbExportDataPath = normalize(this.fbExportDataPath);
        }
    }
    /**
     * Resolve a Portal SDK root directory by searching upwards from a starting point
     */
    resolvePortalSdkRootFrom(startDir) {
        if (!startDir) {
            return null;
        }
        let current = normalize(startDir);
        const visited = new Set();
        while (!visited.has(current)) {
            if (this.isValidPortalSdkRoot(current)) {
                return current;
            }
            const candidate = join(current, 'PortalSDK');
            if (this.isValidPortalSdkRoot(candidate)) {
                return candidate;
            }
            visited.add(current);
            const parent = dirname(current);
            if (parent === current) {
                break;
            }
            current = parent;
        }
        return null;
    }
    /**
     * Determine if a path looks like a Portal SDK root
     */
    isValidPortalSdkRoot(pathToCheck) {
        if (!pathToCheck) {
            return false;
        }
        const sdkDir = join(pathToCheck, 'SDK');
        const projectDir = join(pathToCheck, 'GodotProject');
        const fbExportDir = join(pathToCheck, 'SDK', 'deps', 'FbExportData');
        return (existsSync(sdkDir) &&
            existsSync(projectDir) &&
            existsSync(join(projectDir, 'project.godot')) &&
            existsSync(fbExportDir));
    }
    /**
     * Resolve the project path, defaulting to the detected Portal project when available
     */
    resolveProjectPath(providedPath) {
        if (providedPath) {
            return normalize(providedPath);
        }
        this.detectPortalPaths();
        if (this.portalProjectPath) {
            return this.portalProjectPath;
        }
        return null;
    }
    /**
     * Load JSON from disk with logging on parse failures
     */
    readJsonFile(filePath) {
        try {
            if (!existsSync(filePath)) {
                return null;
            }
            const content = readFileSync(filePath, 'utf-8');
            return JSON.parse(content);
        }
        catch (error) {
            this.logDebug(`Failed to read JSON file ${filePath}: ${error}`);
            return null;
        }
    }
    /**
     * Find Portal script directories for a specific level
     */
    findPortalScriptDirectories(levelName) {
        if (!this.portalProjectPath) {
            return [];
        }
        const scriptsDir = join(this.portalProjectPath, 'scripts');
        if (!existsSync(scriptsDir)) {
            return [];
        }
        const result = [];
        try {
            const theaters = readdirSync(scriptsDir, { withFileTypes: true });
            for (const theater of theaters) {
                if (!theater.isDirectory()) {
                    continue;
                }
                const levelDir = join(scriptsDir, theater.name, levelName);
                if (existsSync(levelDir)) {
                    result.push(normalize(levelDir));
                }
            }
        }
        catch (error) {
            this.logDebug(`Failed to scan Portal script directories: ${error}`);
        }
        return result;
    }
    /**
     * Get a helper script path from the Portal gdconverter utilities
     */
    getGdConverterScriptPath(scriptName) {
        this.detectPortalPaths();
        if (!this.portalSdkPath) {
            return null;
        }
        const scriptPath = join(this.portalSdkPath, 'SDK', 'deps', 'gdconverter', 'src', 'gdconverter', scriptName);
        if (existsSync(scriptPath)) {
            return normalize(scriptPath);
        }
        return null;
    }
    /**
     * Ensure a Python interpreter is available for Portal SDK scripts
     */
    async ensurePythonCommand() {
        if (this.pythonCommand && (await this.validatePythonCommand(this.pythonCommand))) {
            return this.pythonCommand;
        }
        const tested = new Set();
        const candidates = [];
        if (this.initialConfig?.pythonPath) {
            candidates.push(this.initialConfig.pythonPath);
        }
        if (process.env.PYTHON_PATH) {
            candidates.push(process.env.PYTHON_PATH);
        }
        candidates.push('python3', 'python');
        for (const candidate of candidates) {
            if (!candidate) {
                continue;
            }
            if (tested.has(candidate)) {
                continue;
            }
            tested.add(candidate);
            if (await this.validatePythonCommand(candidate)) {
                this.pythonCommand = candidate;
                this.logDebug(`Using Python command: ${candidate}`);
                return candidate;
            }
        }
        throw new Error('Unable to locate a Python interpreter. Set PYTHON_PATH or pythonPath in the server configuration.');
    }
    /**
     * Validate a python command by checking it can report its version
     */
    async validatePythonCommand(command) {
        try {
            await execFileAsync(command, ['--version']);
            return true;
        }
        catch (error) {
            this.logDebug(`Python validation failed for ${command}: ${error}`);
            return false;
        }
    }
    /**
     * Execute a Python script and return stdout/stderr information
     */
    async runPythonScript(scriptPath, args, options) {
        const pythonCommand = await this.ensurePythonCommand();
        return await new Promise((resolve, reject) => {
            const child = spawn(pythonCommand, [scriptPath, ...args], {
                cwd: options?.cwd,
                stdio: 'pipe',
            });
            let stdout = '';
            let stderr = '';
            child.stdout.on('data', (data) => {
                stdout += data.toString();
            });
            child.stderr.on('data', (data) => {
                stderr += data.toString();
            });
            child.on('error', (error) => {
                reject(error);
            });
            child.on('close', (code) => {
                resolve({
                    stdout,
                    stderr,
                    exitCode: code ?? 0,
                });
            });
        });
    }
    /**
     * Detect the Godot executable path based on the operating system
     */
    async detectGodotPath() {
        // If godotPath is already set and valid, use it
        if (this.godotPath && await this.isValidGodotPath(this.godotPath)) {
            this.logDebug(`Using existing Godot path: ${this.godotPath}`);
            return;
        }
        // Check environment variable next
        if (process.env.GODOT_PATH) {
            const normalizedPath = normalize(process.env.GODOT_PATH);
            this.logDebug(`Checking GODOT_PATH environment variable: ${normalizedPath}`);
            if (await this.isValidGodotPath(normalizedPath)) {
                this.godotPath = normalizedPath;
                this.logDebug(`Using Godot path from environment: ${this.godotPath}`);
                return;
            }
            else {
                this.logDebug(`GODOT_PATH environment variable is invalid`);
            }
        }
        // Auto-detect based on platform
        const osPlatform = process.platform;
        this.logDebug(`Auto-detecting Godot path for platform: ${osPlatform}`);
        const possiblePaths = [
            'godot', // Check if 'godot' is in PATH first
        ];
        // Add platform-specific paths
        if (osPlatform === 'darwin') {
            possiblePaths.push('/Applications/Godot.app/Contents/MacOS/Godot', '/Applications/Godot_4.app/Contents/MacOS/Godot', `${process.env.HOME}/Applications/Godot.app/Contents/MacOS/Godot`, `${process.env.HOME}/Applications/Godot_4.app/Contents/MacOS/Godot`, `${process.env.HOME}/Library/Application Support/Steam/steamapps/common/Godot Engine/Godot.app/Contents/MacOS/Godot`);
        }
        else if (osPlatform === 'win32') {
            possiblePaths.push('C:\\Program Files\\Godot\\Godot.exe', 'C:\\Program Files (x86)\\Godot\\Godot.exe', 'C:\\Program Files\\Godot_4\\Godot.exe', 'C:\\Program Files (x86)\\Godot_4\\Godot.exe', `${process.env.USERPROFILE}\\Godot\\Godot.exe`);
        }
        else if (osPlatform === 'linux') {
            possiblePaths.push('/usr/bin/godot', '/usr/local/bin/godot', '/snap/bin/godot', `${process.env.HOME}/.local/bin/godot`);
        }
        // Try each possible path
        for (const path of possiblePaths) {
            const normalizedPath = normalize(path);
            if (await this.isValidGodotPath(normalizedPath)) {
                this.godotPath = normalizedPath;
                this.logDebug(`Found Godot at: ${normalizedPath}`);
                return;
            }
        }
        // If we get here, we couldn't find Godot
        this.logDebug(`Warning: Could not find Godot in common locations for ${osPlatform}`);
        console.warn(`[SERVER] Could not find Godot in common locations for ${osPlatform}`);
        console.warn(`[SERVER] Set GODOT_PATH=/path/to/godot environment variable or pass { godotPath: '/path/to/godot' } in the config to specify the correct path.`);
        if (this.strictPathValidation) {
            // In strict mode, throw an error
            throw new Error(`Could not find a valid Godot executable. Set GODOT_PATH or provide a valid path in config.`);
        }
        else {
            // Fallback to a default path in non-strict mode; this may not be valid and requires user configuration for reliability
            if (osPlatform === 'win32') {
                this.godotPath = normalize('C:\\Program Files\\Godot\\Godot.exe');
            }
            else if (osPlatform === 'darwin') {
                this.godotPath = normalize('/Applications/Godot.app/Contents/MacOS/Godot');
            }
            else {
                this.godotPath = normalize('/usr/bin/godot');
            }
            this.logDebug(`Using default path: ${this.godotPath}, but this may not work.`);
            console.warn(`[SERVER] Using default path: ${this.godotPath}, but this may not work.`);
            console.warn(`[SERVER] This fallback behavior will be removed in a future version. Set strictPathValidation: true to opt-in to the new behavior.`);
        }
    }
    /**
     * Set a custom Godot path
     * @param customPath Path to the Godot executable
     * @returns True if the path is valid and was set, false otherwise
     */
    async setGodotPath(customPath) {
        if (!customPath) {
            return false;
        }
        // Normalize the path to ensure consistent format across platforms
        // (e.g., backslashes to forward slashes on Windows, resolving relative paths)
        const normalizedPath = normalize(customPath);
        if (await this.isValidGodotPath(normalizedPath)) {
            this.godotPath = normalizedPath;
            this.logDebug(`Godot path set to: ${normalizedPath}`);
            return true;
        }
        this.logDebug(`Failed to set invalid Godot path: ${normalizedPath}`);
        return false;
    }
    /**
     * Clean up resources when shutting down
     */
    async cleanup() {
        this.logDebug('Cleaning up resources');
        if (this.activeProcess) {
            this.logDebug('Killing active Godot process');
            this.activeProcess.process.kill();
            this.activeProcess = null;
        }
        await this.server.close();
    }
    /**
     * Check if the Godot version is 4.4 or later
     * @param version The Godot version string
     * @returns True if the version is 4.4 or later
     */
    isGodot44OrLater(version) {
        const match = version.match(/^(\d+)\.(\d+)/);
        if (match) {
            const major = parseInt(match[1], 10);
            const minor = parseInt(match[2], 10);
            return major > 4 || (major === 4 && minor >= 4);
        }
        return false;
    }
    /**
     * Normalize parameters to camelCase format
     * @param params Object with either snake_case or camelCase keys
     * @returns Object with all keys in camelCase format
     */
    normalizeParameters(params) {
        if (!params || typeof params !== 'object') {
            return params;
        }
        const result = {};
        for (const key in params) {
            if (Object.prototype.hasOwnProperty.call(params, key)) {
                let normalizedKey = key;
                // If the key is in snake_case, convert it to camelCase using our mapping
                if (key.includes('_') && this.parameterMappings[key]) {
                    normalizedKey = this.parameterMappings[key];
                }
                // Handle nested objects recursively
                if (typeof params[key] === 'object' && params[key] !== null && !Array.isArray(params[key])) {
                    result[normalizedKey] = this.normalizeParameters(params[key]);
                }
                else {
                    result[normalizedKey] = params[key];
                }
            }
        }
        return result;
    }
    /**
     * Convert camelCase keys to snake_case
     * @param params Object with camelCase keys
     * @returns Object with snake_case keys
     */
    convertCamelToSnakeCase(params) {
        const result = {};
        for (const key in params) {
            if (Object.prototype.hasOwnProperty.call(params, key)) {
                // Convert camelCase to snake_case
                const snakeKey = this.reverseParameterMappings[key] || key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
                // Handle nested objects recursively
                if (typeof params[key] === 'object' && params[key] !== null && !Array.isArray(params[key])) {
                    result[snakeKey] = this.convertCamelToSnakeCase(params[key]);
                }
                else {
                    result[snakeKey] = params[key];
                }
            }
        }
        return result;
    }
    /**
     * Execute a Godot operation using the operations script
     * @param operation The operation to execute
     * @param params The parameters for the operation
     * @param projectPath The path to the Godot project
     * @returns The stdout and stderr from the operation
     */
    async executeOperation(operation, params, projectPath) {
        this.logDebug(`Executing operation: ${operation} in project: ${projectPath}`);
        this.logDebug(`Original operation params: ${JSON.stringify(params)}`);
        // Convert camelCase parameters to snake_case for Godot script
        const snakeCaseParams = this.convertCamelToSnakeCase(params);
        this.logDebug(`Converted snake_case params: ${JSON.stringify(snakeCaseParams)}`);
        // Ensure godotPath is set
        if (!this.godotPath) {
            await this.detectGodotPath();
            if (!this.godotPath) {
                throw new Error('Could not find a valid Godot executable path');
            }
        }
        try {
            // Serialize the snake_case parameters to a valid JSON string
            const paramsJson = JSON.stringify(snakeCaseParams);
            // Escape single quotes in the JSON string to prevent command injection
            const escapedParams = paramsJson.replace(/'/g, "'\\''");
            // On Windows, cmd.exe does not strip single quotes, so we use
            // double quotes and escape them to ensure the JSON is parsed
            // correctly by Godot.
            const isWindows = process.platform === 'win32';
            const quotedParams = isWindows
                ? `\"${paramsJson.replace(/\"/g, '\\"')}\"`
                : `'${escapedParams}'`;
            // Add debug arguments if debug mode is enabled
            const debugArgs = GODOT_DEBUG_MODE ? ['--debug-godot'] : [];
            // Construct the command with the operation and JSON parameters
            const cmd = [
                `"${this.godotPath}"`,
                '--headless',
                '--path',
                `"${projectPath}"`,
                '--script',
                `"${this.operationsScriptPath}"`,
                operation,
                quotedParams, // Pass the JSON string as a single argument
                ...debugArgs,
            ].join(' ');
            this.logDebug(`Command: ${cmd}`);
            const { stdout, stderr } = await execAsync(cmd);
            return { stdout, stderr };
        }
        catch (error) {
            // If execAsync throws, it still contains stdout/stderr
            if (error instanceof Error && 'stdout' in error && 'stderr' in error) {
                const execError = error;
                return {
                    stdout: execError.stdout,
                    stderr: execError.stderr,
                };
            }
            throw error;
        }
    }
    /**
     * Get the structure of a Godot project
     * @param projectPath Path to the Godot project
     * @returns Object representing the project structure
     */
    async getProjectStructure(projectPath) {
        try {
            // Get top-level directories in the project
            const entries = readdirSync(projectPath, { withFileTypes: true });
            const structure = {
                scenes: [],
                scripts: [],
                assets: [],
                other: [],
            };
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    const dirName = entry.name.toLowerCase();
                    // Skip hidden directories
                    if (dirName.startsWith('.')) {
                        continue;
                    }
                    // Count files in common directories
                    if (dirName === 'scenes' || dirName.includes('scene')) {
                        structure.scenes.push(entry.name);
                    }
                    else if (dirName === 'scripts' || dirName.includes('script')) {
                        structure.scripts.push(entry.name);
                    }
                    else if (dirName === 'assets' ||
                        dirName === 'textures' ||
                        dirName === 'models' ||
                        dirName === 'sounds' ||
                        dirName === 'music') {
                        structure.assets.push(entry.name);
                    }
                    else {
                        structure.other.push(entry.name);
                    }
                }
            }
            return structure;
        }
        catch (error) {
            this.logDebug(`Error getting project structure: ${error}`);
            return { error: 'Failed to get project structure' };
        }
    }
    /**
     * Find Godot projects in a directory
     * @param directory Directory to search
     * @param recursive Whether to search recursively
     * @returns Array of Godot projects
     */
    findGodotProjects(directory, recursive) {
        const projects = [];
        try {
            // Check if the directory itself is a Godot project
            const projectFile = join(directory, 'project.godot');
            if (existsSync(projectFile)) {
                projects.push({
                    path: directory,
                    name: basename(directory),
                });
            }
            // If not recursive, only check immediate subdirectories
            if (!recursive) {
                const entries = readdirSync(directory, { withFileTypes: true });
                for (const entry of entries) {
                    if (entry.isDirectory()) {
                        const subdir = join(directory, entry.name);
                        const projectFile = join(subdir, 'project.godot');
                        if (existsSync(projectFile)) {
                            projects.push({
                                path: subdir,
                                name: entry.name,
                            });
                        }
                    }
                }
            }
            else {
                // Recursive search
                const entries = readdirSync(directory, { withFileTypes: true });
                for (const entry of entries) {
                    if (entry.isDirectory()) {
                        const subdir = join(directory, entry.name);
                        // Skip hidden directories
                        if (entry.name.startsWith('.')) {
                            continue;
                        }
                        // Check if this directory is a Godot project
                        const projectFile = join(subdir, 'project.godot');
                        if (existsSync(projectFile)) {
                            projects.push({
                                path: subdir,
                                name: entry.name,
                            });
                        }
                        else {
                            // Recursively search this directory
                            const subProjects = this.findGodotProjects(subdir, true);
                            projects.push(...subProjects);
                        }
                    }
                }
            }
        }
        catch (error) {
            this.logDebug(`Error searching directory ${directory}: ${error}`);
        }
        return projects;
    }
    /**
     * Set up the tool handlers for the MCP server
     */
    setupToolHandlers() {
        // Define available tools
        this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
            tools: [
                {
                    name: 'launch_editor',
                    description: 'Launch Godot editor for a specific project (defaults to the detected Portal project)',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            projectPath: {
                                type: 'string',
                                description: 'Path to the Godot project directory (defaults to Battlefield Portal project when available)',
                            },
                        },
                        required: [],
                    },
                },
                {
                    name: 'run_project',
                    description: 'Run the Godot project and capture output (defaults to the detected Portal project)',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            projectPath: {
                                type: 'string',
                                description: 'Path to the Godot project directory (defaults to Battlefield Portal project when available)',
                            },
                            scene: {
                                type: 'string',
                                description: 'Optional: Specific scene to run',
                            },
                        },
                        required: [],
                    },
                },
                {
                    name: 'get_debug_output',
                    description: 'Get the current debug output and errors',
                    inputSchema: {
                        type: 'object',
                        properties: {},
                        required: [],
                    },
                },
                {
                    name: 'stop_project',
                    description: 'Stop the currently running Godot project',
                    inputSchema: {
                        type: 'object',
                        properties: {},
                        required: [],
                    },
                },
                {
                    name: 'get_godot_version',
                    description: 'Get the installed Godot version',
                    inputSchema: {
                        type: 'object',
                        properties: {},
                        required: [],
                    },
                },
                {
                    name: 'list_projects',
                    description: 'List Godot projects in a directory',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            directory: {
                                type: 'string',
                                description: 'Directory to search for Godot projects',
                            },
                            recursive: {
                                type: 'boolean',
                                description: 'Whether to search recursively (default: false)',
                            },
                        },
                        required: ['directory'],
                    },
                },
                {
                    name: 'get_project_info',
                    description: 'Retrieve metadata about a Godot project',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            projectPath: {
                                type: 'string',
                                description: 'Path to the Godot project directory (defaults to Battlefield Portal project when available)',
                            },
                        },
                        required: [],
                    },
                },
                {
                    name: 'create_scene',
                    description: 'Create a new Godot scene file',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            projectPath: {
                                type: 'string',
                                description: 'Path to the Godot project directory (defaults to Battlefield Portal project when available)',
                            },
                            scenePath: {
                                type: 'string',
                                description: 'Path where the scene file will be saved (relative to project)',
                            },
                            rootNodeType: {
                                type: 'string',
                                description: 'Type of the root node (e.g., Node2D, Node3D)',
                                default: 'Node2D',
                            },
                        },
                        required: ['scenePath'],
                    },
                },
                {
                    name: 'add_node',
                    description: 'Add a node to an existing scene',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            projectPath: {
                                type: 'string',
                                description: 'Path to the Godot project directory (defaults to Battlefield Portal project when available)',
                            },
                            scenePath: {
                                type: 'string',
                                description: 'Path to the scene file (relative to project)',
                            },
                            parentNodePath: {
                                type: 'string',
                                description: 'Path to the parent node (e.g., "root" or "root/Player")',
                                default: 'root',
                            },
                            nodeType: {
                                type: 'string',
                                description: 'Type of node to add (e.g., Sprite2D, CollisionShape2D)',
                            },
                            nodeName: {
                                type: 'string',
                                description: 'Name for the new node',
                            },
                            properties: {
                                type: 'object',
                                description: 'Optional properties to set on the node',
                            },
                        },
                        required: ['scenePath', 'nodeType', 'nodeName'],
                    },
                },
                {
                    name: 'load_sprite',
                    description: 'Load a sprite into a Sprite2D node',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            projectPath: {
                                type: 'string',
                                description: 'Path to the Godot project directory (defaults to Battlefield Portal project when available)',
                            },
                            scenePath: {
                                type: 'string',
                                description: 'Path to the scene file (relative to project)',
                            },
                            nodePath: {
                                type: 'string',
                                description: 'Path to the Sprite2D node (e.g., "root/Player/Sprite2D")',
                            },
                            texturePath: {
                                type: 'string',
                                description: 'Path to the texture file (relative to project)',
                            },
                        },
                        required: ['scenePath', 'nodePath', 'texturePath'],
                    },
                },
                {
                    name: 'export_mesh_library',
                    description: 'Export a scene as a MeshLibrary resource',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            projectPath: {
                                type: 'string',
                                description: 'Path to the Godot project directory (defaults to Battlefield Portal project when available)',
                            },
                            scenePath: {
                                type: 'string',
                                description: 'Path to the scene file (.tscn) to export',
                            },
                            outputPath: {
                                type: 'string',
                                description: 'Path where the mesh library (.res) will be saved',
                            },
                            meshItemNames: {
                                type: 'array',
                                items: {
                                    type: 'string',
                                },
                                description: 'Optional: Names of specific mesh items to include (defaults to all)',
                            },
                        },
                        required: ['scenePath', 'outputPath'],
                    },
                },
                {
                    name: 'save_scene',
                    description: 'Save changes to a scene file',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            projectPath: {
                                type: 'string',
                                description: 'Path to the Godot project directory (defaults to Battlefield Portal project when available)',
                            },
                            scenePath: {
                                type: 'string',
                                description: 'Path to the scene file (relative to project)',
                            },
                            newPath: {
                                type: 'string',
                                description: 'Optional: New path to save the scene to (for creating variants)',
                            },
                        },
                        required: ['scenePath'],
                    },
                },
                {
                    name: 'get_uid',
                    description: 'Get the UID for a specific file in a Godot project (for Godot 4.4+)',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            projectPath: {
                                type: 'string',
                                description: 'Path to the Godot project directory (defaults to Battlefield Portal project when available)',
                            },
                            filePath: {
                                type: 'string',
                                description: 'Path to the file (relative to project) for which to get the UID',
                            },
                        },
                        required: ['filePath'],
                    },
                },
                {
                    name: 'update_project_uids',
                    description: 'Update UID references in a Godot project by resaving resources (for Godot 4.4+)',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            projectPath: {
                                type: 'string',
                                description: 'Path to the Godot project directory (defaults to Battlefield Portal project when available)',
                            },
                        },
                        required: [],
                    },
                },
                {
                    name: 'get_portal_sdk_info',
                    description: 'Inspect detected Battlefield Portal SDK paths and configuration',
                    inputSchema: {
                        type: 'object',
                        properties: {},
                        required: [],
                    },
                },
                {
                    name: 'list_portal_levels',
                    description: 'List available Battlefield Portal levels and related resources',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            fbExportDataPath: {
                                type: 'string',
                                description: 'Optional: Override path to the FbExportData directory',
                            },
                            projectPath: {
                                type: 'string',
                                description: 'Optional: Override path to the Battlefield Portal Godot project',
                            },
                        },
                        required: [],
                    },
                },
                {
                    name: 'export_portal_level',
                    description: 'Export a Battlefield Portal level to spatial JSON using the gdconverter tooling',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            scenePath: {
                                type: 'string',
                                description: 'Path to the scene (.tscn) file to export (relative to the project by default)',
                            },
                            outputDir: {
                                type: 'string',
                                description: 'Optional: Directory where the exported .spatial.json will be written (defaults to a portal_exports folder inside the project)',
                            },
                            projectPath: {
                                type: 'string',
                                description: 'Optional: Override path to the Battlefield Portal Godot project',
                            },
                            fbExportDataPath: {
                                type: 'string',
                                description: 'Optional: Override path to the FbExportData directory',
                            },
                        },
                        required: ['scenePath'],
                    },
                },
                {
                    name: 'create_portal_project',
                    description: 'Regenerate the Battlefield Portal Godot project from FbExportData assets',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            fbExportDataPath: {
                                type: 'string',
                                description: 'Optional: Override path to the FbExportData directory',
                            },
                            outputDir: {
                                type: 'string',
                                description: 'Optional: Destination directory for the generated project (defaults to the detected Portal project path)',
                            },
                            overwriteLevels: {
                                type: 'boolean',
                                description: 'Whether to overwrite existing level scenes when regenerating',
                                default: false,
                            },
                        },
                        required: [],
                    },
                },
            ],
        }));
        // Handle tool calls
        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            this.logDebug(`Handling tool request: ${request.params.name}`);
            switch (request.params.name) {
                case 'launch_editor':
                    return await this.handleLaunchEditor(request.params.arguments);
                case 'run_project':
                    return await this.handleRunProject(request.params.arguments);
                case 'get_debug_output':
                    return await this.handleGetDebugOutput();
                case 'stop_project':
                    return await this.handleStopProject();
                case 'get_godot_version':
                    return await this.handleGetGodotVersion();
                case 'list_projects':
                    return await this.handleListProjects(request.params.arguments);
                case 'get_project_info':
                    return await this.handleGetProjectInfo(request.params.arguments);
                case 'create_scene':
                    return await this.handleCreateScene(request.params.arguments);
                case 'add_node':
                    return await this.handleAddNode(request.params.arguments);
                case 'load_sprite':
                    return await this.handleLoadSprite(request.params.arguments);
                case 'export_mesh_library':
                    return await this.handleExportMeshLibrary(request.params.arguments);
                case 'save_scene':
                    return await this.handleSaveScene(request.params.arguments);
                case 'get_uid':
                    return await this.handleGetUid(request.params.arguments);
                case 'update_project_uids':
                    return await this.handleUpdateProjectUids(request.params.arguments);
                case 'get_portal_sdk_info':
                    return await this.handleGetPortalSdkInfo();
                case 'list_portal_levels':
                    return await this.handleListPortalLevels(request.params.arguments);
                case 'export_portal_level':
                    return await this.handleExportPortalLevel(request.params.arguments);
                case 'create_portal_project':
                    return await this.handleCreatePortalProject(request.params.arguments);
                default:
                    throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
            }
        });
    }
    /**
     * Handle the launch_editor tool
     * @param args Tool arguments
     */
    async handleLaunchEditor(args) {
        // Normalize parameters to camelCase
        args = this.normalizeParameters(args);
        if (args.projectPath && !this.validatePath(args.projectPath)) {
            return this.createErrorResponse('Invalid project path', ['Provide a valid path without ".." or other potentially unsafe characters']);
        }
        const projectPath = this.resolveProjectPath(args.projectPath);
        if (!projectPath) {
            return this.createErrorResponse('Project path is required', [
                'Provide a valid path to a Godot project directory',
                'Ensure the Battlefield Portal SDK is installed and detectable',
            ]);
        }
        try {
            // Ensure godotPath is set
            if (!this.godotPath) {
                await this.detectGodotPath();
                if (!this.godotPath) {
                    return this.createErrorResponse('Could not find a valid Godot executable path', [
                        'Ensure Godot is installed correctly',
                        'Set GODOT_PATH environment variable to specify the correct path',
                    ]);
                }
            }
            // Check if the project directory exists and contains a project.godot file
            const projectFile = join(projectPath, 'project.godot');
            if (!existsSync(projectFile)) {
                return this.createErrorResponse(`Not a valid Godot project: ${projectPath}`, [
                    'Ensure the path points to a directory containing a project.godot file',
                    'Use list_projects to find valid Godot projects',
                ]);
            }
            this.logDebug(`Launching Godot editor for project: ${projectPath}`);
            const process = spawn(this.godotPath, ['-e', '--path', projectPath], {
                stdio: 'pipe',
            });
            process.on('error', (err) => {
                console.error('Failed to start Godot editor:', err);
            });
            return {
                content: [
                    {
                        type: 'text',
                        text: `Godot editor launched successfully for project at ${projectPath}.`,
                    },
                ],
            };
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            return this.createErrorResponse(`Failed to launch Godot editor: ${errorMessage}`, [
                'Ensure Godot is installed correctly',
                'Check if the GODOT_PATH environment variable is set correctly',
                'Verify the project path is accessible',
            ]);
        }
    }
    /**
     * Handle the run_project tool
     * @param args Tool arguments
     */
    async handleRunProject(args) {
        // Normalize parameters to camelCase
        args = this.normalizeParameters(args);
        if (args.projectPath && !this.validatePath(args.projectPath)) {
            return this.createErrorResponse('Invalid project path', ['Provide a valid path without ".." or other potentially unsafe characters']);
        }
        const projectPath = this.resolveProjectPath(args.projectPath);
        if (!projectPath) {
            return this.createErrorResponse('Project path is required', [
                'Provide a valid path to a Godot project directory',
                'Ensure the Battlefield Portal SDK is installed and detectable',
            ]);
        }
        try {
            // Check if the project directory exists and contains a project.godot file
            const projectFile = join(projectPath, 'project.godot');
            if (!existsSync(projectFile)) {
                return this.createErrorResponse(`Not a valid Godot project: ${projectPath}`, [
                    'Ensure the path points to a directory containing a project.godot file',
                    'Use list_projects to find valid Godot projects',
                ]);
            }
            // Kill any existing process
            if (this.activeProcess) {
                this.logDebug('Killing existing Godot process before starting a new one');
                this.activeProcess.process.kill();
            }
            const cmdArgs = ['-d', '--path', projectPath];
            if (args.scene && this.validatePath(args.scene)) {
                this.logDebug(`Adding scene parameter: ${args.scene}`);
                cmdArgs.push(args.scene);
            }
            this.logDebug(`Running Godot project: ${projectPath}`);
            const process = spawn(this.godotPath, cmdArgs, { stdio: 'pipe' });
            const output = [];
            const errors = [];
            process.stdout?.on('data', (data) => {
                const lines = data.toString().split('\n');
                output.push(...lines);
                lines.forEach((line) => {
                    if (line.trim())
                        this.logDebug(`[Godot stdout] ${line}`);
                });
            });
            process.stderr?.on('data', (data) => {
                const lines = data.toString().split('\n');
                errors.push(...lines);
                lines.forEach((line) => {
                    if (line.trim())
                        this.logDebug(`[Godot stderr] ${line}`);
                });
            });
            process.on('exit', (code) => {
                this.logDebug(`Godot process exited with code ${code}`);
                if (this.activeProcess && this.activeProcess.process === process) {
                    this.activeProcess = null;
                }
            });
            process.on('error', (err) => {
                console.error('Failed to start Godot process:', err);
                if (this.activeProcess && this.activeProcess.process === process) {
                    this.activeProcess = null;
                }
            });
            this.activeProcess = { process, output, errors };
            return {
                content: [
                    {
                        type: 'text',
                        text: `Godot project started in debug mode from ${projectPath}. Use get_debug_output to see output.`,
                    },
                ],
            };
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            return this.createErrorResponse(`Failed to run Godot project: ${errorMessage}`, [
                'Ensure Godot is installed correctly',
                'Check if the GODOT_PATH environment variable is set correctly',
                'Verify the project path is accessible',
            ]);
        }
    }
    /**
     * Handle the get_debug_output tool
     */
    async handleGetDebugOutput() {
        if (!this.activeProcess) {
            return this.createErrorResponse('No active Godot process.', [
                'Use run_project to start a Godot project first',
                'Check if the Godot process crashed unexpectedly',
            ]);
        }
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
                        output: this.activeProcess.output,
                        errors: this.activeProcess.errors,
                    }, null, 2),
                },
            ],
        };
    }
    /**
     * Handle the stop_project tool
     */
    async handleStopProject() {
        if (!this.activeProcess) {
            return this.createErrorResponse('No active Godot process to stop.', [
                'Use run_project to start a Godot project first',
                'The process may have already terminated',
            ]);
        }
        this.logDebug('Stopping active Godot process');
        this.activeProcess.process.kill();
        const output = this.activeProcess.output;
        const errors = this.activeProcess.errors;
        this.activeProcess = null;
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
                        message: 'Godot project stopped',
                        finalOutput: output,
                        finalErrors: errors,
                    }, null, 2),
                },
            ],
        };
    }
    /**
     * Handle the get_godot_version tool
     */
    async handleGetGodotVersion() {
        try {
            // Ensure godotPath is set
            if (!this.godotPath) {
                await this.detectGodotPath();
                if (!this.godotPath) {
                    return this.createErrorResponse('Could not find a valid Godot executable path', [
                        'Ensure Godot is installed correctly',
                        'Set GODOT_PATH environment variable to specify the correct path',
                    ]);
                }
            }
            this.logDebug('Getting Godot version');
            const { stdout } = await execAsync(`"${this.godotPath}" --version`);
            return {
                content: [
                    {
                        type: 'text',
                        text: stdout.trim(),
                    },
                ],
            };
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            return this.createErrorResponse(`Failed to get Godot version: ${errorMessage}`, [
                'Ensure Godot is installed correctly',
                'Check if the GODOT_PATH environment variable is set correctly',
            ]);
        }
    }
    /**
     * Handle the list_projects tool
     */
    async handleListProjects(args) {
        // Normalize parameters to camelCase
        args = this.normalizeParameters(args);
        if (!args.directory) {
            return this.createErrorResponse('Directory is required', ['Provide a valid directory path to search for Godot projects']);
        }
        if (!this.validatePath(args.directory)) {
            return this.createErrorResponse('Invalid directory path', ['Provide a valid path without ".." or other potentially unsafe characters']);
        }
        try {
            this.logDebug(`Listing Godot projects in directory: ${args.directory}`);
            if (!existsSync(args.directory)) {
                return this.createErrorResponse(`Directory does not exist: ${args.directory}`, ['Provide a valid directory path that exists on the system']);
            }
            const recursive = args.recursive === true;
            const projects = this.findGodotProjects(args.directory, recursive);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify(projects, null, 2),
                    },
                ],
            };
        }
        catch (error) {
            return this.createErrorResponse(`Failed to list projects: ${error?.message || 'Unknown error'}`, [
                'Ensure the directory exists and is accessible',
                'Check if you have permission to read the directory',
            ]);
        }
    }
    /**
     * Get the structure of a Godot project asynchronously by counting files recursively
     * @param projectPath Path to the Godot project
     * @returns Promise resolving to an object with counts of scenes, scripts, assets, and other files
     */
    getProjectStructureAsync(projectPath) {
        return new Promise((resolve) => {
            try {
                const structure = {
                    scenes: 0,
                    scripts: 0,
                    assets: 0,
                    other: 0,
                };
                const scanDirectory = (currentPath) => {
                    const entries = readdirSync(currentPath, { withFileTypes: true });
                    for (const entry of entries) {
                        const entryPath = join(currentPath, entry.name);
                        // Skip hidden files and directories
                        if (entry.name.startsWith('.')) {
                            continue;
                        }
                        if (entry.isDirectory()) {
                            // Recursively scan subdirectories
                            scanDirectory(entryPath);
                        }
                        else if (entry.isFile()) {
                            // Count file by extension
                            const ext = entry.name.split('.').pop()?.toLowerCase();
                            if (ext === 'tscn') {
                                structure.scenes++;
                            }
                            else if (ext === 'gd' || ext === 'gdscript' || ext === 'cs') {
                                structure.scripts++;
                            }
                            else if (['png', 'jpg', 'jpeg', 'webp', 'svg', 'ttf', 'wav', 'mp3', 'ogg'].includes(ext || '')) {
                                structure.assets++;
                            }
                            else {
                                structure.other++;
                            }
                        }
                    }
                };
                // Start scanning from the project root
                scanDirectory(projectPath);
                resolve(structure);
            }
            catch (error) {
                this.logDebug(`Error getting project structure asynchronously: ${error}`);
                resolve({
                    error: 'Failed to get project structure',
                    scenes: 0,
                    scripts: 0,
                    assets: 0,
                    other: 0
                });
            }
        });
    }
    /**
     * Handle the get_project_info tool
     */
    async handleGetProjectInfo(args) {
        // Normalize parameters to camelCase
        args = this.normalizeParameters(args);
        if (args.projectPath && !this.validatePath(args.projectPath)) {
            return this.createErrorResponse('Invalid project path', ['Provide a valid path without ".." or other potentially unsafe characters']);
        }
        const projectPath = this.resolveProjectPath(args.projectPath);
        if (!projectPath) {
            return this.createErrorResponse('Project path is required', [
                'Provide a valid path to a Godot project directory',
                'Ensure the Battlefield Portal SDK is installed and detectable',
            ]);
        }
        try {
            // Ensure godotPath is set
            if (!this.godotPath) {
                await this.detectGodotPath();
                if (!this.godotPath) {
                    return this.createErrorResponse('Could not find a valid Godot executable path', [
                        'Ensure Godot is installed correctly',
                        'Set GODOT_PATH environment variable to specify the correct path',
                    ]);
                }
            }
            // Check if the project directory exists and contains a project.godot file
            const projectFile = join(projectPath, 'project.godot');
            if (!existsSync(projectFile)) {
                return this.createErrorResponse(`Not a valid Godot project: ${projectPath}`, [
                    'Ensure the path points to a directory containing a project.godot file',
                    'Use list_projects to find valid Godot projects',
                ]);
            }
            this.logDebug(`Getting project info for: ${projectPath}`);
            // Get Godot version
            const execOptions = { timeout: 10000 }; // 10 second timeout
            const { stdout } = await execAsync(`"${this.godotPath}" --version`, execOptions);
            // Get project structure using the recursive method
            const projectStructure = await this.getProjectStructureAsync(projectPath);
            // Extract project name from project.godot file
            let projectName = basename(projectPath);
            try {
                const projectFileContent = readFileSync(projectFile, 'utf8');
                const configNameMatch = projectFileContent.match(/config\/name="([^"]+)"/);
                if (configNameMatch && configNameMatch[1]) {
                    projectName = configNameMatch[1];
                    this.logDebug(`Found project name in config: ${projectName}`);
                }
            }
            catch (error) {
                this.logDebug(`Error reading project file: ${error}`);
                // Continue with default project name if extraction fails
            }
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            name: projectName,
                            path: projectPath,
                            godotVersion: stdout.trim(),
                            structure: projectStructure,
                        }, null, 2),
                    },
                ],
            };
        }
        catch (error) {
            return this.createErrorResponse(`Failed to get project info: ${error?.message || 'Unknown error'}`, [
                'Ensure Godot is installed correctly',
                'Check if the GODOT_PATH environment variable is set correctly',
                'Verify the project path is accessible',
            ]);
        }
    }
    /**
     * Handle the create_scene tool
     */
    async handleCreateScene(args) {
        // Normalize parameters to camelCase
        args = this.normalizeParameters(args);
        if (!args.scenePath) {
            return this.createErrorResponse('Scene path is required', ['Provide a valid scene path relative to the project']);
        }
        if ((args.projectPath && !this.validatePath(args.projectPath)) || !this.validatePath(args.scenePath)) {
            return this.createErrorResponse('Invalid path', ['Provide valid paths without ".." or other potentially unsafe characters']);
        }
        const projectPath = this.resolveProjectPath(args.projectPath);
        if (!projectPath) {
            return this.createErrorResponse('Project path is required', [
                'Provide a valid path to a Godot project directory',
                'Ensure the Battlefield Portal SDK is installed and detectable',
            ]);
        }
        try {
            // Check if the project directory exists and contains a project.godot file
            const projectFile = join(projectPath, 'project.godot');
            if (!existsSync(projectFile)) {
                return this.createErrorResponse(`Not a valid Godot project: ${projectPath}`, [
                    'Ensure the path points to a directory containing a project.godot file',
                    'Use list_projects to find valid Godot projects',
                ]);
            }
            // Prepare parameters for the operation (already in camelCase)
            const params = {
                scenePath: args.scenePath,
                rootNodeType: args.rootNodeType || 'Node2D',
            };
            // Execute the operation
            const { stdout, stderr } = await this.executeOperation('create_scene', params, projectPath);
            if (stderr && stderr.includes('Failed to')) {
                return this.createErrorResponse(`Failed to create scene: ${stderr}`, [
                    'Check if the root node type is valid',
                    'Ensure you have write permissions to the scene path',
                    'Verify the scene path is valid',
                ]);
            }
            return {
                content: [
                    {
                        type: 'text',
                        text: `Scene created successfully at: ${args.scenePath}\n\nOutput: ${stdout}`,
                    },
                ],
            };
        }
        catch (error) {
            return this.createErrorResponse(`Failed to create scene: ${error?.message || 'Unknown error'}`, [
                'Ensure Godot is installed correctly',
                'Check if the GODOT_PATH environment variable is set correctly',
                'Verify the project path is accessible',
            ]);
        }
    }
    /**
     * Handle the add_node tool
     */
    async handleAddNode(args) {
        // Normalize parameters to camelCase
        args = this.normalizeParameters(args);
        if (!args.scenePath || !args.nodeType || !args.nodeName) {
            return this.createErrorResponse('Missing required parameters', ['Provide scenePath, nodeType, and nodeName']);
        }
        if ((args.projectPath && !this.validatePath(args.projectPath)) || !this.validatePath(args.scenePath)) {
            return this.createErrorResponse('Invalid path', ['Provide valid paths without ".." or other potentially unsafe characters']);
        }
        const projectPath = this.resolveProjectPath(args.projectPath);
        if (!projectPath) {
            return this.createErrorResponse('Project path is required', [
                'Provide a valid path to a Godot project directory',
                'Ensure the Battlefield Portal SDK is installed and detectable',
            ]);
        }
        try {
            // Check if the project directory exists and contains a project.godot file
            const projectFile = join(projectPath, 'project.godot');
            if (!existsSync(projectFile)) {
                return this.createErrorResponse(`Not a valid Godot project: ${projectPath}`, [
                    'Ensure the path points to a directory containing a project.godot file',
                    'Use list_projects to find valid Godot projects',
                ]);
            }
            // Check if the scene file exists
            const scenePath = join(projectPath, args.scenePath);
            if (!existsSync(scenePath)) {
                return this.createErrorResponse(`Scene file does not exist: ${args.scenePath}`, [
                    'Ensure the scene path is correct',
                    'Use create_scene to create a new scene first',
                ]);
            }
            // Prepare parameters for the operation (already in camelCase)
            const params = {
                scenePath: args.scenePath,
                nodeType: args.nodeType,
                nodeName: args.nodeName,
            };
            // Add optional parameters
            if (args.parentNodePath) {
                params.parentNodePath = args.parentNodePath;
            }
            if (args.properties) {
                params.properties = args.properties;
            }
            // Execute the operation
            const { stdout, stderr } = await this.executeOperation('add_node', params, projectPath);
            if (stderr && stderr.includes('Failed to')) {
                return this.createErrorResponse(`Failed to add node: ${stderr}`, [
                    'Check if the node type is valid',
                    'Ensure the parent node path exists',
                    'Verify the scene file is valid',
                ]);
            }
            return {
                content: [
                    {
                        type: 'text',
                        text: `Node '${args.nodeName}' of type '${args.nodeType}' added successfully to '${args.scenePath}'.\n\nOutput: ${stdout}`,
                    },
                ],
            };
        }
        catch (error) {
            return this.createErrorResponse(`Failed to add node: ${error?.message || 'Unknown error'}`, [
                'Ensure Godot is installed correctly',
                'Check if the GODOT_PATH environment variable is set correctly',
                'Verify the project path is accessible',
            ]);
        }
    }
    /**
     * Handle the load_sprite tool
     */
    async handleLoadSprite(args) {
        // Normalize parameters to camelCase
        args = this.normalizeParameters(args);
        if (!args.scenePath || !args.nodePath || !args.texturePath) {
            return this.createErrorResponse('Missing required parameters', ['Provide scenePath, nodePath, and texturePath']);
        }
        if ((args.projectPath && !this.validatePath(args.projectPath)) ||
            !this.validatePath(args.scenePath) ||
            !this.validatePath(args.nodePath) ||
            !this.validatePath(args.texturePath)) {
            return this.createErrorResponse('Invalid path', ['Provide valid paths without ".." or other potentially unsafe characters']);
        }
        const projectPath = this.resolveProjectPath(args.projectPath);
        if (!projectPath) {
            return this.createErrorResponse('Project path is required', [
                'Provide a valid path to a Godot project directory',
                'Ensure the Battlefield Portal SDK is installed and detectable',
            ]);
        }
        try {
            // Check if the project directory exists and contains a project.godot file
            const projectFile = join(projectPath, 'project.godot');
            if (!existsSync(projectFile)) {
                return this.createErrorResponse(`Not a valid Godot project: ${projectPath}`, [
                    'Ensure the path points to a directory containing a project.godot file',
                    'Use list_projects to find valid Godot projects',
                ]);
            }
            // Check if the scene file exists
            const scenePath = join(projectPath, args.scenePath);
            if (!existsSync(scenePath)) {
                return this.createErrorResponse(`Scene file does not exist: ${args.scenePath}`, [
                    'Ensure the scene path is correct',
                    'Use create_scene to create a new scene first',
                ]);
            }
            // Check if the texture file exists
            const texturePath = join(projectPath, args.texturePath);
            if (!existsSync(texturePath)) {
                return this.createErrorResponse(`Texture file does not exist: ${args.texturePath}`, [
                    'Ensure the texture path is correct',
                    'Upload or create the texture file first',
                ]);
            }
            // Prepare parameters for the operation (already in camelCase)
            const params = {
                scenePath: args.scenePath,
                nodePath: args.nodePath,
                texturePath: args.texturePath,
            };
            // Execute the operation
            const { stdout, stderr } = await this.executeOperation('load_sprite', params, projectPath);
            if (stderr && stderr.includes('Failed to')) {
                return this.createErrorResponse(`Failed to load sprite: ${stderr}`, [
                    'Check if the node path is correct',
                    'Ensure the node is a Sprite2D, Sprite3D, or TextureRect',
                    'Verify the texture file is a valid image format',
                ]);
            }
            return {
                content: [
                    {
                        type: 'text',
                        text: `Sprite loaded successfully with texture: ${args.texturePath}\n\nOutput: ${stdout}`,
                    },
                ],
            };
        }
        catch (error) {
            return this.createErrorResponse(`Failed to load sprite: ${error?.message || 'Unknown error'}`, [
                'Ensure Godot is installed correctly',
                'Check if the GODOT_PATH environment variable is set correctly',
                'Verify the project path is accessible',
            ]);
        }
    }
    /**
     * Handle the export_mesh_library tool
     */
    async handleExportMeshLibrary(args) {
        // Normalize parameters to camelCase
        args = this.normalizeParameters(args);
        if (!args.scenePath || !args.outputPath) {
            return this.createErrorResponse('Missing required parameters', ['Provide scenePath and outputPath']);
        }
        if ((args.projectPath && !this.validatePath(args.projectPath)) ||
            !this.validatePath(args.scenePath) ||
            !this.validatePath(args.outputPath)) {
            return this.createErrorResponse('Invalid path', ['Provide valid paths without ".." or other potentially unsafe characters']);
        }
        const projectPath = this.resolveProjectPath(args.projectPath);
        if (!projectPath) {
            return this.createErrorResponse('Project path is required', [
                'Provide a valid path to a Godot project directory',
                'Ensure the Battlefield Portal SDK is installed and detectable',
            ]);
        }
        try {
            // Check if the project directory exists and contains a project.godot file
            const projectFile = join(projectPath, 'project.godot');
            if (!existsSync(projectFile)) {
                return this.createErrorResponse(`Not a valid Godot project: ${projectPath}`, [
                    'Ensure the path points to a directory containing a project.godot file',
                    'Use list_projects to find valid Godot projects',
                ]);
            }
            // Check if the scene file exists
            const scenePath = join(projectPath, args.scenePath);
            if (!existsSync(scenePath)) {
                return this.createErrorResponse(`Scene file does not exist: ${args.scenePath}`, [
                    'Ensure the scene path is correct',
                    'Use create_scene to create a new scene first',
                ]);
            }
            // Prepare parameters for the operation (already in camelCase)
            const params = {
                scenePath: args.scenePath,
                outputPath: args.outputPath,
            };
            // Add optional parameters
            if (args.meshItemNames && Array.isArray(args.meshItemNames)) {
                params.meshItemNames = args.meshItemNames;
            }
            // Execute the operation
            const { stdout, stderr } = await this.executeOperation('export_mesh_library', params, projectPath);
            if (stderr && stderr.includes('Failed to')) {
                return this.createErrorResponse(`Failed to export mesh library: ${stderr}`, [
                    'Check if the scene contains valid 3D meshes',
                    'Ensure the output path is valid',
                    'Verify the scene file is valid',
                ]);
            }
            return {
                content: [
                    {
                        type: 'text',
                        text: `MeshLibrary exported successfully to: ${args.outputPath}\n\nOutput: ${stdout}`,
                    },
                ],
            };
        }
        catch (error) {
            return this.createErrorResponse(`Failed to export mesh library: ${error?.message || 'Unknown error'}`, [
                'Ensure Godot is installed correctly',
                'Check if the GODOT_PATH environment variable is set correctly',
                'Verify the project path is accessible',
            ]);
        }
    }
    /**
     * Handle the save_scene tool
     */
    async handleSaveScene(args) {
        // Normalize parameters to camelCase
        args = this.normalizeParameters(args);
        if (!args.scenePath) {
            return this.createErrorResponse('Missing required parameters', ['Provide scenePath']);
        }
        if ((args.projectPath && !this.validatePath(args.projectPath)) || !this.validatePath(args.scenePath)) {
            return this.createErrorResponse('Invalid path', ['Provide valid paths without ".." or other potentially unsafe characters']);
        }
        // If newPath is provided, validate it
        if (args.newPath && !this.validatePath(args.newPath)) {
            return this.createErrorResponse('Invalid new path', ['Provide a valid new path without ".." or other potentially unsafe characters']);
        }
        const projectPath = this.resolveProjectPath(args.projectPath);
        if (!projectPath) {
            return this.createErrorResponse('Project path is required', [
                'Provide a valid path to a Godot project directory',
                'Ensure the Battlefield Portal SDK is installed and detectable',
            ]);
        }
        try {
            // Check if the project directory exists and contains a project.godot file
            const projectFile = join(projectPath, 'project.godot');
            if (!existsSync(projectFile)) {
                return this.createErrorResponse(`Not a valid Godot project: ${projectPath}`, [
                    'Ensure the path points to a directory containing a project.godot file',
                    'Use list_projects to find valid Godot projects',
                ]);
            }
            // Check if the scene file exists
            const scenePath = join(projectPath, args.scenePath);
            if (!existsSync(scenePath)) {
                return this.createErrorResponse(`Scene file does not exist: ${args.scenePath}`, [
                    'Ensure the scene path is correct',
                    'Use create_scene to create a new scene first',
                ]);
            }
            // Prepare parameters for the operation (already in camelCase)
            const params = {
                scenePath: args.scenePath,
            };
            // Add optional parameters
            if (args.newPath) {
                params.newPath = args.newPath;
            }
            // Execute the operation
            const { stdout, stderr } = await this.executeOperation('save_scene', params, projectPath);
            if (stderr && stderr.includes('Failed to')) {
                return this.createErrorResponse(`Failed to save scene: ${stderr}`, [
                    'Check if the scene file is valid',
                    'Ensure you have write permissions to the output path',
                    'Verify the scene can be properly packed',
                ]);
            }
            const savePath = args.newPath || args.scenePath;
            return {
                content: [
                    {
                        type: 'text',
                        text: `Scene saved successfully to: ${savePath}\n\nOutput: ${stdout}`,
                    },
                ],
            };
        }
        catch (error) {
            return this.createErrorResponse(`Failed to save scene: ${error?.message || 'Unknown error'}`, [
                'Ensure Godot is installed correctly',
                'Check if the GODOT_PATH environment variable is set correctly',
                'Verify the project path is accessible',
            ]);
        }
    }
    /**
     * Handle the get_uid tool
     */
    async handleGetUid(args) {
        // Normalize parameters to camelCase
        args = this.normalizeParameters(args);
        if (!args.filePath) {
            return this.createErrorResponse('Missing required parameters', ['Provide filePath']);
        }
        if ((args.projectPath && !this.validatePath(args.projectPath)) || !this.validatePath(args.filePath)) {
            return this.createErrorResponse('Invalid path', ['Provide valid paths without ".." or other potentially unsafe characters']);
        }
        const projectPath = this.resolveProjectPath(args.projectPath);
        if (!projectPath) {
            return this.createErrorResponse('Project path is required', [
                'Provide a valid path to a Godot project directory',
                'Ensure the Battlefield Portal SDK is installed and detectable',
            ]);
        }
        try {
            // Ensure godotPath is set
            if (!this.godotPath) {
                await this.detectGodotPath();
                if (!this.godotPath) {
                    return this.createErrorResponse('Could not find a valid Godot executable path', [
                        'Ensure Godot is installed correctly',
                        'Set GODOT_PATH environment variable to specify the correct path',
                    ]);
                }
            }
            // Check if the project directory exists and contains a project.godot file
            const projectFile = join(projectPath, 'project.godot');
            if (!existsSync(projectFile)) {
                return this.createErrorResponse(`Not a valid Godot project: ${projectPath}`, [
                    'Ensure the path points to a directory containing a project.godot file',
                    'Use list_projects to find valid Godot projects',
                ]);
            }
            // Check if the file exists
            const filePath = join(projectPath, args.filePath);
            if (!existsSync(filePath)) {
                return this.createErrorResponse(`File does not exist: ${args.filePath}`, ['Ensure the file path is correct']);
            }
            // Get Godot version to check if UIDs are supported
            const { stdout: versionOutput } = await execAsync(`"${this.godotPath}" --version`);
            const version = versionOutput.trim();
            if (!this.isGodot44OrLater(version)) {
                return this.createErrorResponse(`UIDs are only supported in Godot 4.4 or later. Current version: ${version}`, [
                    'Upgrade to Godot 4.4 or later to use UIDs',
                    'Use resource paths instead of UIDs for this version of Godot',
                ]);
            }
            // Prepare parameters for the operation (already in camelCase)
            const params = {
                filePath: args.filePath,
            };
            // Execute the operation
            const { stdout, stderr } = await this.executeOperation('get_uid', params, projectPath);
            if (stderr && stderr.includes('Failed to')) {
                return this.createErrorResponse(`Failed to get UID: ${stderr}`, [
                    'Check if the file is a valid Godot resource',
                    'Ensure the file path is correct',
                ]);
            }
            return {
                content: [
                    {
                        type: 'text',
                        text: `UID for ${args.filePath}: ${stdout.trim()}`,
                    },
                ],
            };
        }
        catch (error) {
            return this.createErrorResponse(`Failed to get UID: ${error?.message || 'Unknown error'}`, [
                'Ensure Godot is installed correctly',
                'Check if the GODOT_PATH environment variable is set correctly',
                'Verify the project path is accessible',
            ]);
        }
    }
    /**
     * Handle the update_project_uids tool
     */
    async handleUpdateProjectUids(args) {
        // Normalize parameters to camelCase
        args = this.normalizeParameters(args);
        if (args.projectPath && !this.validatePath(args.projectPath)) {
            return this.createErrorResponse('Invalid project path', ['Provide a valid path without ".." or other potentially unsafe characters']);
        }
        const projectPath = this.resolveProjectPath(args.projectPath);
        if (!projectPath) {
            return this.createErrorResponse('Project path is required', [
                'Provide a valid path to a Godot project directory',
                'Ensure the Battlefield Portal SDK is installed and detectable',
            ]);
        }
        try {
            // Ensure godotPath is set
            if (!this.godotPath) {
                await this.detectGodotPath();
                if (!this.godotPath) {
                    return this.createErrorResponse('Could not find a valid Godot executable path', [
                        'Ensure Godot is installed correctly',
                        'Set GODOT_PATH environment variable to specify the correct path',
                    ]);
                }
            }
            // Check if the project directory exists and contains a project.godot file
            const projectFile = join(projectPath, 'project.godot');
            if (!existsSync(projectFile)) {
                return this.createErrorResponse(`Not a valid Godot project: ${projectPath}`, [
                    'Ensure the path points to a directory containing a project.godot file',
                    'Use list_projects to find valid Godot projects',
                ]);
            }
            // Get Godot version to check if UIDs are supported
            const { stdout: versionOutput } = await execAsync(`"${this.godotPath}" --version`);
            const version = versionOutput.trim();
            if (!this.isGodot44OrLater(version)) {
                return this.createErrorResponse(`UIDs are only supported in Godot 4.4 or later. Current version: ${version}`, [
                    'Upgrade to Godot 4.4 or later to use UIDs',
                    'Use resource paths instead of UIDs for this version of Godot',
                ]);
            }
            // Prepare parameters for the operation (already in camelCase)
            const params = {
                projectPath,
            };
            // Execute the operation
            const { stdout, stderr } = await this.executeOperation('resave_resources', params, projectPath);
            if (stderr && stderr.includes('Failed to')) {
                return this.createErrorResponse(`Failed to update project UIDs: ${stderr}`, [
                    'Check if the project is valid',
                    'Ensure you have write permissions to the project directory',
                ]);
            }
            return {
                content: [
                    {
                        type: 'text',
                        text: `Project UIDs updated successfully.\n\nOutput: ${stdout}`,
                    },
                ],
            };
        }
        catch (error) {
            return this.createErrorResponse(`Failed to update project UIDs: ${error?.message || 'Unknown error'}`, [
                'Ensure Godot is installed correctly',
                'Check if the GODOT_PATH environment variable is set correctly',
                'Verify the project path is accessible',
            ]);
        }
    }
    /**
     * Provide details about detected Battlefield Portal SDK paths
     */
    async handleGetPortalSdkInfo() {
        this.detectPortalPaths();
        const info = {
            portalSdkPath: this.portalSdkPath,
            portalSdkPathExists: this.portalSdkPath ? existsSync(this.portalSdkPath) : false,
            portalProjectPath: this.portalProjectPath,
            portalProjectPathExists: this.portalProjectPath
                ? existsSync(join(this.portalProjectPath, 'project.godot'))
                : false,
            fbExportDataPath: this.fbExportDataPath,
            fbExportDataPathExists: this.fbExportDataPath ? existsSync(this.fbExportDataPath) : false,
            pythonCommand: this.pythonCommand,
        };
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(info, null, 2),
                },
            ],
        };
    }
    /**
     * List available Battlefield Portal levels and metadata
     */
    async handleListPortalLevels(args) {
        args = this.normalizeParameters(args);
        this.detectPortalPaths();
        let fbExportDataPath = null;
        if (typeof args.fbExportDataPath === 'string' && args.fbExportDataPath.trim()) {
            fbExportDataPath = normalize(args.fbExportDataPath);
        }
        else if (this.fbExportDataPath) {
            fbExportDataPath = this.fbExportDataPath;
        }
        if (!fbExportDataPath || !existsSync(fbExportDataPath)) {
            return this.createErrorResponse('FbExportData path not found', [
                'Install or extract the Battlefield Portal SDK assets',
                'Provide fbExportDataPath pointing to SDK/deps/FbExportData',
            ]);
        }
        const levelsDir = join(fbExportDataPath, 'levels');
        if (!existsSync(levelsDir)) {
            return this.createErrorResponse('Levels directory missing inside FbExportData', ['Verify the Battlefield Portal SDK installation is complete']);
        }
        let projectPath = null;
        if (typeof args.projectPath === 'string' && args.projectPath.trim()) {
            if (!this.validatePath(args.projectPath)) {
                return this.createErrorResponse('Invalid project path', ['Provide a valid path without ".." or other potentially unsafe characters']);
            }
            projectPath = normalize(args.projectPath);
        }
        else if (this.portalProjectPath) {
            projectPath = this.portalProjectPath;
        }
        if (projectPath && !existsSync(projectPath)) {
            projectPath = null;
        }
        const levelInfo = this.readJsonFile(join(fbExportDataPath, 'level_info.json')) ?? {};
        const levels = [];
        try {
            const entries = readdirSync(levelsDir, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isFile() || !entry.name.endsWith('.spatial.json')) {
                    continue;
                }
                const baseName = entry.name.replace('.spatial.json', '');
                const level = {
                    name: baseName,
                    spatialPath: normalize(join(levelsDir, entry.name)),
                };
                if (levelInfo && levelInfo[baseName]) {
                    level.info = levelInfo[baseName];
                }
                if (projectPath) {
                    const staticDir = join(projectPath, 'static');
                    const assetsPath = join(staticDir, `${baseName}_Assets.tscn`);
                    const terrainPath = join(staticDir, `${baseName}_Terrain.tscn`);
                    if (existsSync(assetsPath)) {
                        level.assetsScene = normalize(assetsPath);
                    }
                    if (existsSync(terrainPath)) {
                        level.terrainScene = normalize(terrainPath);
                    }
                    const scriptDirs = this.findPortalScriptDirectories(baseName);
                    if (scriptDirs.length > 0) {
                        level.scriptDirectories = scriptDirs;
                    }
                }
                levels.push(level);
            }
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return this.createErrorResponse(`Failed to enumerate Portal levels: ${message}`, ['Verify the FbExportData directory is accessible']);
        }
        levels.sort((a, b) => a.name.localeCompare(b.name));
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
                        fbExportDataPath,
                        projectPath,
                        count: levels.length,
                        levels,
                    }, null, 2),
                },
            ],
        };
    }
    /**
     * Export a Portal level to spatial JSON via the gdconverter tooling
     */
    async handleExportPortalLevel(args) {
        args = this.normalizeParameters(args);
        if (!args.scenePath) {
            return this.createErrorResponse('Scene path is required', ['Provide the path to the scene (.tscn) file to export']);
        }
        if (!this.validatePath(args.scenePath)) {
            return this.createErrorResponse('Invalid scene path', ['Provide a scene path without ".." or other potentially unsafe characters']);
        }
        if (args.outputDir && !this.validatePath(args.outputDir)) {
            return this.createErrorResponse('Invalid output directory', ['Provide an output directory without ".." or other potentially unsafe characters']);
        }
        const projectPath = this.resolveProjectPath(args.projectPath);
        if (!projectPath) {
            return this.createErrorResponse('Project path is required', [
                'Provide a valid path to the Battlefield Portal Godot project',
                'Ensure the Portal SDK has been detected correctly',
            ]);
        }
        const fbExportDataPath = typeof args.fbExportDataPath === 'string' && args.fbExportDataPath.trim()
            ? normalize(args.fbExportDataPath)
            : this.fbExportDataPath;
        if (!fbExportDataPath || !existsSync(fbExportDataPath)) {
            return this.createErrorResponse('FbExportData path not found', [
                'Install or extract the Battlefield Portal SDK assets',
                'Provide fbExportDataPath pointing to SDK/deps/FbExportData',
            ]);
        }
        const converterScript = this.getGdConverterScriptPath('export_tscn.py');
        if (!converterScript) {
            return this.createErrorResponse('Could not locate export_tscn.py in the Battlefield Portal SDK', [
                'Verify the Portal SDK repository is available',
                'Set PORTAL_SDK_PATH to the SDK root',
            ]);
        }
        const sceneFile = this.toAbsolutePath(projectPath, args.scenePath);
        if (!existsSync(sceneFile)) {
            return this.createErrorResponse(`Scene file does not exist: ${sceneFile}`, [
                'Ensure the scene path is correct relative to the project',
                'Open the scene in Godot to verify it exists',
            ]);
        }
        let outputDir;
        if (typeof args.outputDir === 'string' && args.outputDir.trim()) {
            outputDir = this.toAbsolutePath(projectPath, args.outputDir);
        }
        else {
            outputDir = join(projectPath, 'portal_exports');
        }
        mkdirSync(outputDir, { recursive: true });
        try {
            const { stdout, stderr, exitCode } = await this.runPythonScript(converterScript, [
                sceneFile,
                fbExportDataPath,
                outputDir,
            ]);
            if (exitCode !== 0) {
                return this.createErrorResponse(`Portal export script failed with exit code ${exitCode}`, [
                    'Inspect the stdout/stderr output for details',
                    'Verify the scene and FbExportData paths are correct',
                ]);
            }
            const trimmedStdout = stdout.trim();
            const trimmedStderr = stderr.trim();
            const lines = trimmedStdout.split(/\r?\n/).filter((line) => line.trim().length > 0);
            const exportedFile = lines.length > 0 ? normalize(lines[lines.length - 1]) : null;
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            sceneFile: normalize(sceneFile),
                            fbExportDataPath,
                            outputDir: normalize(outputDir),
                            exportedFile,
                            stdout: trimmedStdout,
                            stderr: trimmedStderr,
                        }, null, 2),
                    },
                ],
            };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return this.createErrorResponse(`Failed to export Portal level: ${message}`, [
                'Ensure Python 3 is installed and accessible',
                'Verify the Battlefield Portal SDK gdconverter dependencies are installed',
            ]);
        }
    }
    /**
     * Rebuild the Battlefield Portal Godot project from FbExportData assets
     */
    async handleCreatePortalProject(args) {
        args = this.normalizeParameters(args);
        this.detectPortalPaths();
        const fbExportDataPath = typeof args.fbExportDataPath === 'string' && args.fbExportDataPath.trim()
            ? normalize(args.fbExportDataPath)
            : this.fbExportDataPath;
        if (!fbExportDataPath || !existsSync(fbExportDataPath)) {
            return this.createErrorResponse('FbExportData path not found', [
                'Install or extract the Battlefield Portal SDK assets',
                'Provide fbExportDataPath pointing to SDK/deps/FbExportData',
            ]);
        }
        let outputDir;
        if (typeof args.outputDir === 'string' && args.outputDir.trim()) {
            outputDir = normalize(args.outputDir);
        }
        else if (this.portalProjectPath) {
            outputDir = this.portalProjectPath;
        }
        else if (this.portalSdkPath) {
            outputDir = normalize(join(this.portalSdkPath, 'GodotProject'));
        }
        else {
            outputDir = normalize(join(process.cwd(), 'PortalGodotProject'));
        }
        mkdirSync(outputDir, { recursive: true });
        const converterScript = this.getGdConverterScriptPath('create_godot.py');
        if (!converterScript) {
            return this.createErrorResponse('Could not locate create_godot.py in the Battlefield Portal SDK', [
                'Verify the Portal SDK repository is available',
                'Set PORTAL_SDK_PATH to the SDK root',
            ]);
        }
        const scriptArgs = [fbExportDataPath, outputDir];
        if (args.overwriteLevels === true) {
            scriptArgs.push('--overwrite-levels');
        }
        try {
            const { stdout, stderr, exitCode } = await this.runPythonScript(converterScript, scriptArgs);
            if (exitCode !== 0) {
                return this.createErrorResponse(`Portal project generation failed with exit code ${exitCode}`, [
                    'Inspect the stdout/stderr output for details',
                    'Ensure Python dependencies from SDK/requirements.txt are installed',
                ]);
            }
            const trimmedStdout = stdout.trim();
            const trimmedStderr = stderr.trim();
            this.portalProjectPath = normalize(outputDir);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            projectPath: this.portalProjectPath,
                            fbExportDataPath,
                            stdout: trimmedStdout,
                            stderr: trimmedStderr,
                        }, null, 2),
                    },
                ],
            };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return this.createErrorResponse(`Failed to regenerate the Portal project: ${message}`, [
                'Ensure Python 3 is installed and accessible',
                'Verify the Battlefield Portal SDK dependencies are installed',
            ]);
        }
    }
    /**
     * Run the MCP server
     */
    async run() {
        try {
            // Detect Godot path before starting the server
            await this.detectGodotPath();
            if (!this.godotPath) {
                console.error('[SERVER] Failed to find a valid Godot executable path');
                console.error('[SERVER] Please set GODOT_PATH environment variable or provide a valid path');
                process.exit(1);
            }
            // Check if the path is valid
            const isValid = await this.isValidGodotPath(this.godotPath);
            if (!isValid) {
                if (this.strictPathValidation) {
                    // In strict mode, exit if the path is invalid
                    console.error(`[SERVER] Invalid Godot path: ${this.godotPath}`);
                    console.error('[SERVER] Please set a valid GODOT_PATH environment variable or provide a valid path');
                    process.exit(1);
                }
                else {
                    // In compatibility mode, warn but continue with the default path
                    console.warn(`[SERVER] Warning: Using potentially invalid Godot path: ${this.godotPath}`);
                    console.warn('[SERVER] This may cause issues when executing Godot commands');
                    console.warn('[SERVER] This fallback behavior will be removed in a future version. Set strictPathValidation: true to opt-in to the new behavior.');
                }
            }
            console.log(`[SERVER] Using Godot at: ${this.godotPath}`);
            const transport = new StdioServerTransport();
            await this.server.connect(transport);
            console.error('Battlefield 6 Portal MCP server running on stdio');
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            console.error('[SERVER] Failed to start:', errorMessage);
            process.exit(1);
        }
    }
}
// Create and run the server
const server = new GodotServer();
server.run().catch((error) => {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Failed to run server:', errorMessage);
    process.exit(1);
});
