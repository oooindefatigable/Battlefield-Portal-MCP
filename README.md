# Battlefield 6 Portal MCP Server

Battlefield 6 Portal MCP Server is a Model Context Protocol (MCP) server that blends Godot engine automation with Battlefield Portal SDK workflows. It enables AI assistants to manage Battlefield 6 Portal projects programmatically—launching the editor, exporting spatial data, regenerating Portal content, and keeping debug feedback flowing without leaving your MCP-enabled IDE.

## Overview

This server extends the original Godot automation stack to understand the Battlefield Portal SDK published at [battlefield-portal-community/PortalSDK](https://github.com/battlefield-portal-community/PortalSDK). By exposing the tooling through MCP, assistants can iterate on Battlefield 6 Portal experiences, capture live feedback, and regenerate assets as part of a tight development loop.

## Key Capabilities

### Godot Automation
- Launch the Godot editor for a specified project
- Run Battlefield Portal or custom Godot projects with streamed logs
- Capture and return debug output
- Start and stop running projects
- Query the installed Godot version
- Discover Godot projects, inspect structure, and manage scenes
- Create scenes, add nodes, load textures, export MeshLibrary resources, and manage UID updates for Godot 4.4+

### Battlefield Portal Enhancements
- Inspect detected Battlefield Portal SDK, project, and FbExportData paths
- Enumerate available Portal spatial levels
- Convert Godot scenes into `.spatial.json` files via gdconverter
- Regenerate the Battlefield Portal Godot project from FbExportData assets

## Requirements
- [Godot Engine](https://godotengine.org/download) installed locally
- [Battlefield Portal SDK](https://github.com/battlefield-portal-community/PortalSDK) cloned and configured
- [Python 3.9+](https://www.python.org/downloads/) available for gdconverter scripts
- Node.js and npm
- An MCP-compatible assistant such as Cline or Cursor

## Getting Started

### Clone and Build

```bash
git clone https://github.com/oooindefatigable/Battlefield-Portal-MCP.git
cd Battlefield-Portal-MCP/godot-mcp
npm install
npm run build
```

### Configure Your Assistant

#### Cline
Add the server to `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`:

```json
{
  "mcpServers": {
    "bf6portal": {
      "command": "node",
      "args": ["/absolute/path/to/Battlefield-Portal-MCP/godot-mcp/build/index.js"],
      "env": {
        "DEBUG": "true"
      },
      "disabled": false,
      "autoApprove": [
        "launch_editor",
        "run_project",
        "get_debug_output",
        "stop_project",
        "get_godot_version",
        "list_projects",
        "get_project_info",
        "create_scene",
        "add_node",
        "load_sprite",
        "export_mesh_library",
        "save_scene",
        "get_uid",
        "update_project_uids",
        "get_portal_sdk_info",
        "list_portal_levels",
        "export_portal_level",
        "create_portal_project"
      ]
    }
  }
}
```

#### Claude Desktop

Add the server to your Claude Desktop configuration file (typically located at
`%AppData%\Claude\claude_desktop_config.json` on Windows). Replace
`<your-user>` with your Windows username if you installed the repository under
`C:\\Users\\<your-user>\\Documents\\MCP\\Battlefield-Portal-MCP-main\\Battlefield-Portal-MCP-main`:

```json
{
  "mcpServers": {
    "bf6portal": {
      "command": "node",
      "args": [
        "C:\\Users\\<your-user>\\Documents\\MCP\\Battlefield-Portal-MCP-main\\Battlefield-Portal-MCP-main\\godot-mcp\\build\\index.js"
      ],
      "env": {
        "DEBUG": "true"
      },
      "autoApprove": [
        "launch_editor",
        "run_project",
        "get_debug_output",
        "stop_project",
        "get_godot_version",
        "list_projects",
        "get_project_info",
        "create_scene",
        "add_node",
        "load_sprite",
        "export_mesh_library",
        "save_scene",
        "get_uid",
        "update_project_uids",
        "get_portal_sdk_info",
        "list_portal_levels",
        "export_portal_level",
        "create_portal_project"
      ]
    }
  }
}
```

#### Cursor

1. Open **Cursor Settings → Features → MCP**
2. Click **+ Add New MCP Server**
3. Set **Name** to `bf6portal`
4. Set **Type** to `command`
5. Set **Command** to `node /absolute/path/to/Battlefield-Portal-MCP/godot-mcp/build/index.js`
6. Save and refresh the MCP server card

For project-scoped setup, create `.cursor/mcp.json` inside your workspace:

```json
{
  "mcpServers": {
    "bf6portal": {
      "command": "node",
      "args": ["/absolute/path/to/Battlefield-Portal-MCP/godot-mcp/build/index.js"],
      "env": {
        "DEBUG": "true"
      }
    }
  }
}
```

#### Ejecutar el servidor manualmente en Windows

Para verificar que la compilación funcione de forma independiente, abre PowerShell
o el Símbolo del sistema y ejecuta:

```powershell
node "C:\Users\<your-user>\Documents\MCP\Battlefield-Portal-MCP-main\Battlefield-Portal-MCP-main\godot-mcp\build\index.js"
```

Reemplaza `<your-user>` por tu usuario de Windows y ajusta la ruta si clonaste el
repositorio en otra carpeta.

### Optional Environment Variables

The MCP server inspects the following environment variables. Configure them when
auto-detection does not locate your local installations:

- `GODOT_PATH`: Absolute path to the Godot executable
- `PORTAL_SDK_PATH`: Battlefield Portal SDK root directory
- `PORTAL_PROJECT_PATH`: Override the detected Portal Godot project
- `PORTAL_FB_EXPORT_PATH`: Override `SDK/deps/FbExportData`
- `PYTHON_PATH`: Specify a Python interpreter for gdconverter
- `DEBUG`: Set to `true` for verbose server logging to stderr

#### Windows (PowerShell)

```powershell
# Current session only
$env:GODOT_PATH = "C:\\Program Files\\Godot\\Godot.exe"
$env:PORTAL_SDK_PATH = "C:\\SDKs\\PortalSDK"
$env:PORTAL_PROJECT_PATH = "C:\\SDKs\\PortalSDK\\GodotProject"
$env:PORTAL_FB_EXPORT_PATH = "C:\\SDKs\\PortalSDK\\SDK\\deps\\FbExportData"
$env:PYTHON_PATH = "C:\\Users\\<your-user>\\AppData\\Local\\Programs\\Python\\Python313\\python.exe"
$env:DEBUG = "true"

# Persist between sessions
setx GODOT_PATH "C:\\Program Files\\Godot\\Godot.exe"
setx PORTAL_SDK_PATH "C:\\SDKs\\PortalSDK"
setx PORTAL_PROJECT_PATH "C:\\SDKs\\PortalSDK\\GodotProject"
setx PORTAL_FB_EXPORT_PATH "C:\\SDKs\\PortalSDK\\SDK\\deps\\FbExportData"
setx PYTHON_PATH "C:\\Users\\<your-user>\\AppData\\Local\\Programs\\Python\\Python313\\python.exe"
setx DEBUG "true"
```

> Reinicia Claude Desktop o tu terminal para que los cambios permanentes surtan efecto.

#### macOS / Linux (bash, zsh)

```bash
export GODOT_PATH="/Applications/Godot.app/Contents/MacOS/Godot"
export PORTAL_SDK_PATH="$HOME/PortalSDK"
export PORTAL_PROJECT_PATH="$HOME/PortalSDK/GodotProject"
export PORTAL_FB_EXPORT_PATH="$HOME/PortalSDK/SDK/deps/FbExportData"
export PYTHON_PATH="$(which python3)"
export DEBUG="true"

# Opcional: añade estas líneas a ~/.bashrc o ~/.zshrc para que sean permanentes
```

## Battlefield Portal SDK Integration

When the Battlefield Portal SDK is available, the server automatically discovers:

- The SDK root and gdconverter utilities
- The bundled Portal Godot project (`GodotProject`)
- Exported spatial data under `SDK/deps/FbExportData`

Tools such as `get_portal_sdk_info`, `list_portal_levels`, `export_portal_level`, and `create_portal_project` expose this information through MCP. Override the discovery paths with the environment variables above if your SDK lives outside the repository.

## Example Prompts

- "Launch the Godot editor for my Portal project"
- "Run the Battlefield 6 Portal project and stream any errors"
- "Export the MP_Aftermath scene to ./exports"
- "List all Battlefield Portal levels detected by the SDK"
- "Regenerate the Portal project from FbExportData"
- "Add a Sprite2D node to my player scene"
- "Update UID references after migrating to Godot 4.4"

## Troubleshooting

- **Godot executable not found**: Set `GODOT_PATH` or provide `{ godotPath: '/path/to/godot' }` in configuration.
- **SDK not detected**: Ensure the Portal SDK is cloned and referenced via `PORTAL_SDK_PATH` if necessary.
- **Invalid project path**: Point to directories containing a `project.godot` file.
- **Build issues**: Verify dependencies with `npm install` and rerun `npm run build`.
- **Assistant cannot run tools**: Confirm the MCP server is enabled and auto approvals cover required operations.

## License

Released under the MIT License. See [LICENSE](godot-mcp/LICENSE) for details.
