#!/usr/bin/env bash
# =============================================================================
# Dotfiles Install Script
# Supports: Ubuntu/Debian, Arch Linux, macOS
# Usage: bash scripts/install.sh
# =============================================================================
set -euo pipefail

# =============================================================================
# Colors & Helpers
# =============================================================================
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

info()    { echo -e "${BLUE}[INFO]${NC} $*"; }
success() { echo -e "${GREEN}[OK]${NC} $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*"; }
section() { echo -e "\n${BOLD}${CYAN}══════════════════════════════════════════${NC}"; echo -e "${BOLD}${CYAN}  $*${NC}"; echo -e "${BOLD}${CYAN}══════════════════════════════════════════${NC}\n"; }

# Ask y/n - defaults to yes
confirm() {
    local prompt="$1"
    local default="${2:-y}"
    local yn
    if [[ "$default" == "y" ]]; then
        read -rp "$(echo -e "${BOLD}$prompt [Y/n]:${NC} ")" yn
        yn="${yn:-y}"
    else
        read -rp "$(echo -e "${BOLD}$prompt [y/N]:${NC} ")" yn
        yn="${yn:-n}"
    fi
    [[ "$yn" =~ ^[Yy] ]]
}

# Check if command exists
has() { command -v "$1" &>/dev/null; }

# =============================================================================
# Detect OS & Package Manager
# =============================================================================
detect_os() {
    OS=""
    DISTRO=""
    PKG=""

    case "$(uname -s)" in
        Linux)
            OS="linux"
            if [ -f /etc/os-release ]; then
                . /etc/os-release
                case "$ID" in
                    ubuntu|debian|pop|linuxmint|elementary|zorin)
                        DISTRO="debian"
                        PKG="apt"
                        ;;
                    arch|manjaro|endeavouros|garuda)
                        DISTRO="arch"
                        PKG="pacman"
                        ;;
                    *)
                        # Try to detect by package manager
                        if has apt; then
                            DISTRO="debian"
                            PKG="apt"
                        elif has pacman; then
                            DISTRO="arch"
                            PKG="pacman"
                        else
                            error "Unsupported Linux distribution: $ID"
                            exit 1
                        fi
                        ;;
                esac
            fi
            ;;
        Darwin)
            OS="macos"
            DISTRO="macos"
            PKG="brew"
            ;;
        *)
            error "Unsupported operating system: $(uname -s)"
            exit 1
            ;;
    esac

    success "Detected: OS=$OS, DISTRO=$DISTRO, PKG=$PKG"
}

# =============================================================================
# Package Manager Wrappers
# =============================================================================
pkg_update() {
    info "Updating package lists..."
    case "$PKG" in
        apt)    sudo apt update -qq ;;
        pacman) sudo pacman -Sy --noconfirm ;;
        brew)   brew update ;;
    esac
}

pkg_install() {
    local packages=("$@")
    case "$PKG" in
        apt)    sudo apt install -y -qq "${packages[@]}" ;;
        pacman) sudo pacman -S --noconfirm --needed "${packages[@]}" ;;
        brew)   brew install "${packages[@]}" ;;
    esac
}

# Install AUR packages (Arch only) - uses yay or paru
aur_install() {
    local packages=("$@")
    if has yay; then
        yay -S --noconfirm --needed "${packages[@]}"
    elif has paru; then
        paru -S --noconfirm --needed "${packages[@]}"
    else
        warn "No AUR helper found. Installing yay..."
        sudo pacman -S --noconfirm --needed git base-devel
        local tmpdir
        tmpdir=$(mktemp -d)
        git clone https://aur.archlinux.org/yay-bin.git "$tmpdir/yay-bin"
        (cd "$tmpdir/yay-bin" && makepkg -si --noconfirm)
        rm -rf "$tmpdir"
        yay -S --noconfirm --needed "${packages[@]}"
    fi
}

# =============================================================================
# Dotfiles Directory
# =============================================================================
DOTFILES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="$HOME/.dotfiles-backup-$(date +%Y%m%d-%H%M%S)"

# =============================================================================
# Installation Functions
# =============================================================================

install_homebrew() {
    if [[ "$OS" == "macos" ]] && ! has brew; then
        section "Installing Homebrew"
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
        # Add to PATH for this session
        if [[ -f /opt/homebrew/bin/brew ]]; then
            eval "$(/opt/homebrew/bin/brew shellenv)"
        elif [[ -f /usr/local/bin/brew ]]; then
            eval "$(/usr/local/bin/brew shellenv)"
        fi
        success "Homebrew installed"
    fi
}

install_shell() {
    section "Shell & Prompt"

    # Zsh
    if ! has zsh; then
        info "Installing zsh..."
        pkg_install zsh
    else
        success "zsh already installed"
    fi

    # Starship
    if ! has starship; then
        info "Installing starship..."
        if [[ "$PKG" == "brew" ]]; then
            brew install starship
        else
            curl -sS https://starship.rs/install.sh | sh -s -- -y
        fi
    else
        success "starship already installed"
    fi

    success "Shell & Prompt done"
}

install_terminal() {
    section "Terminal & Multiplexer"

    # Ghostty
    if ! has ghostty; then
        info "Installing Ghostty..."
        case "$PKG" in
            brew)
                brew install --cask ghostty
                ;;
            apt)
                info "Building Ghostty from source (this may take a while)..."
                # Install build dependencies
                sudo apt install -y -qq \
                    libgtk-4-dev libadwaita-1-dev git \
                    blueprint-compiler gettext \
                    libxml2-utils desktop-file-utils \
                    appstream appstream-util
                # Need Zig
                if ! has zig; then
                    info "Installing Zig (required to build Ghostty)..."
                    local zig_version="0.14.1"
                    local zig_arch
                    zig_arch="$(uname -m)"
                    curl -sL "https://ziglang.org/download/${zig_version}/zig-linux-${zig_arch}-${zig_version}.tar.xz" | \
                        sudo tar xJ -C /opt/
                    sudo ln -sf "/opt/zig-linux-${zig_arch}-${zig_version}/zig" /usr/local/bin/zig
                fi
                # Build Ghostty
                local ghostty_tmp
                ghostty_tmp=$(mktemp -d)
                git clone --depth 1 https://github.com/ghostty-org/ghostty.git "$ghostty_tmp"
                (cd "$ghostty_tmp" && zig build -Doptimize=ReleaseFast -p /usr/local)
                rm -rf "$ghostty_tmp"
                ;;
            pacman)
                # Ghostty is in the official Arch repos
                pkg_install ghostty
                ;;
        esac
    else
        success "ghostty already installed"
    fi

    # Tmux
    if ! has tmux; then
        info "Installing tmux..."
        pkg_install tmux
    else
        success "tmux already installed"
    fi

    success "Terminal & Multiplexer done"
}

install_editor() {
    section "Editor (Neovim)"

    if ! has nvim; then
        info "Installing Neovim..."
        case "$PKG" in
            apt)
                # Use the official PPA for latest stable
                sudo apt install -y -qq software-properties-common
                sudo add-apt-repository -y ppa:neovim-ppa/stable
                sudo apt update -qq
                sudo apt install -y -qq neovim
                ;;
            pacman)
                pkg_install neovim
                ;;
            brew)
                brew install neovim
                ;;
        esac
    else
        success "neovim already installed"
    fi

    success "Editor done"
}

install_git_tools() {
    section "Git Tools"

    # Git
    if ! has git; then
        info "Installing git..."
        pkg_install git
    else
        success "git already installed"
    fi

    # GitHub CLI
    if ! has gh; then
        info "Installing GitHub CLI..."
        case "$PKG" in
            apt)
                sudo mkdir -p /etc/apt/keyrings
                curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null
                echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | \
                    sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null
                sudo apt update -qq && sudo apt install -y -qq gh
                ;;
            pacman)
                pkg_install github-cli
                ;;
            brew)
                brew install gh
                ;;
        esac
    else
        success "gh already installed"
    fi

    # LazyGit
    if ! has lazygit; then
        info "Installing lazygit..."
        case "$PKG" in
            apt)
                local lazygit_version
                lazygit_version=$(curl -s "https://api.github.com/repos/jesseduffield/lazygit/releases/latest" | grep -Po '"tag_name": "v\K[^"]*')
                curl -Lo /tmp/lazygit.tar.gz "https://github.com/jesseduffield/lazygit/releases/latest/download/lazygit_${lazygit_version}_Linux_x86_64.tar.gz"
                sudo tar xf /tmp/lazygit.tar.gz -C /usr/local/bin lazygit
                rm -f /tmp/lazygit.tar.gz
                ;;
            pacman)
                pkg_install lazygit
                ;;
            brew)
                brew install lazygit
                ;;
        esac
    else
        success "lazygit already installed"
    fi

    success "Git Tools done"
}

install_languages() {
    section "Programming Languages"

    # NVM + Node.js
    if [[ ! -d "$HOME/.nvm" ]]; then
        info "Installing NVM + Node.js..."
        curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
        # Load NVM for this session
        export NVM_DIR="$HOME/.nvm"
        # shellcheck source=/dev/null
        [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
        nvm install --lts
    else
        success "NVM already installed"
    fi

    # Python 3 + pip
    if ! has python3; then
        info "Installing Python 3..."
        case "$PKG" in
            apt)    pkg_install python3 python3-pip python3-venv ;;
            pacman) pkg_install python python-pip ;;
            brew)   brew install python3 ;;
        esac
    else
        success "python3 already installed"
        # Ensure pip is available
        if ! python3 -m pip --version &>/dev/null; then
            info "Installing pip..."
            case "$PKG" in
                apt)    pkg_install python3-pip ;;
                pacman) pkg_install python-pip ;;
                brew)   : ;; # brew's python3 includes pip
            esac
        fi
    fi

    # Rust (via rustup)
    if ! has rustc; then
        info "Installing Rust via rustup..."
        curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
        # shellcheck source=/dev/null
        source "$HOME/.cargo/env"
    else
        success "rust already installed"
    fi

    # Go
    if ! has go; then
        info "Installing Go..."
        case "$PKG" in
            apt)
                local go_version
                go_version=$(curl -s "https://go.dev/dl/?mode=json" | grep -Po '"version": "\K[^"]*' | head -1)
                curl -Lo /tmp/go.tar.gz "https://go.dev/dl/${go_version}.linux-amd64.tar.gz"
                sudo rm -rf /usr/local/go
                sudo tar -C /usr/local -xzf /tmp/go.tar.gz
                rm -f /tmp/go.tar.gz
                # Add to PATH for this session
                export PATH="/usr/local/go/bin:$PATH"
                ;;
            pacman) pkg_install go ;;
            brew)   brew install go ;;
        esac
    else
        success "go already installed"
    fi

    # .NET SDK
    if ! has dotnet; then
        info "Installing .NET SDK..."
        case "$PKG" in
            apt)
                # Microsoft package repository
                curl -fsSL https://packages.microsoft.com/config/ubuntu/$(lsb_release -rs)/packages-microsoft-prod.deb -o /tmp/packages-microsoft-prod.deb
                sudo dpkg -i /tmp/packages-microsoft-prod.deb
                rm -f /tmp/packages-microsoft-prod.deb
                sudo apt update -qq
                sudo apt install -y -qq dotnet-sdk-9.0
                ;;
            pacman) pkg_install dotnet-sdk ;;
            brew)   brew install --cask dotnet-sdk ;;
        esac
    else
        success ".NET SDK already installed"
    fi

    success "Programming Languages done"
}

install_docker() {
    section "Docker"

    case "$OS" in
        linux)
            if ! has docker; then
                info "Installing Docker Engine..."
                case "$PKG" in
                    apt)
                        # Official Docker install
                        sudo apt install -y -qq ca-certificates curl gnupg
                        sudo install -m 0755 -d /etc/apt/keyrings
                        curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
                        sudo chmod a+r /etc/apt/keyrings/docker.gpg
                        echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$UBUNTU_CODENAME") stable" | \
                            sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
                        sudo apt update -qq
                        sudo apt install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
                        # Add user to docker group
                        sudo usermod -aG docker "$USER"
                        info "Added $USER to docker group (log out and back in for this to take effect)"
                        ;;
                    pacman)
                        pkg_install docker docker-compose
                        sudo systemctl enable --now docker.service
                        sudo usermod -aG docker "$USER"
                        info "Added $USER to docker group (log out and back in for this to take effect)"
                        ;;
                esac
            else
                success "docker already installed"
            fi
            ;;
        macos)
            if ! has docker; then
                info "Installing OrbStack (Docker for macOS)..."
                brew install --cask orbstack
            else
                success "docker already installed (via OrbStack or Docker Desktop)"
            fi
            ;;
    esac

    success "Docker done"
}

install_build_tools() {
    section "Build Tools"

    case "$PKG" in
        apt)
            info "Installing build essentials..."
            pkg_install build-essential cmake
            ;;
        pacman)
            info "Installing base-devel + cmake..."
            pkg_install base-devel cmake
            ;;
        brew)
            if ! xcode-select -p &>/dev/null; then
                info "Installing Xcode Command Line Tools..."
                xcode-select --install
                # Wait for installation
                info "Please complete the Xcode CLT installation popup, then press Enter..."
                read -r
            else
                success "Xcode CLT already installed"
            fi
            if ! has cmake; then
                brew install cmake
            fi
            ;;
    esac

    # curl & wget
    has curl  || pkg_install curl
    has wget  || pkg_install wget
    has unzip || pkg_install unzip

    success "Build Tools done"
}

install_fonts() {
    section "Fonts (MesloLGM Nerd Font)"

    local font_src="$DOTFILES_DIR/fonts"

    if [[ ! -d "$font_src" ]] || [[ -z "$(ls -A "$font_src"/*.ttf 2>/dev/null)" ]]; then
        warn "No fonts found in $font_src - skipping"
        return
    fi

    case "$OS" in
        linux)
            local font_dest="$HOME/.local/share/fonts"
            mkdir -p "$font_dest"
            cp "$font_src"/*.ttf "$font_dest/"
            # Rebuild font cache
            if has fc-cache; then
                fc-cache -f "$font_dest"
            fi
            success "Fonts installed to $font_dest"
            ;;
        macos)
            local font_dest="$HOME/Library/Fonts"
            cp "$font_src"/*.ttf "$font_dest/"
            success "Fonts installed to $font_dest"
            ;;
    esac
}

install_aerospace() {
    if [[ "$OS" != "macos" ]]; then
        return
    fi

    section "AeroSpace (macOS Window Manager)"
    if ! has aerospace; then
        info "Installing AeroSpace..."
        brew install --cask nikitabobko/tap/aerospace
    else
        success "AeroSpace already installed"
    fi

    success "AeroSpace done"
}

install_opencode() {
    section "OpenCode (AI CLI Tool)"

    if ! has opencode; then
        info "Installing OpenCode..."
        # Ensure npm is available
        if has npm; then
            npm install -g opencode
        else
            warn "npm not found - cannot install opencode. Install Node.js first."
            return
        fi
    else
        success "opencode already installed"
    fi

    success "OpenCode done"
}

# =============================================================================
# Symlink Dotfiles
# =============================================================================
create_symlink() {
    local src="$1"
    local dest="$2"

    # Skip if source doesn't exist
    if [[ ! -e "$src" ]]; then
        warn "Source not found, skipping: $src"
        return
    fi

    # If destination already exists and is not a symlink, back it up
    if [[ -e "$dest" ]] && [[ ! -L "$dest" ]]; then
        mkdir -p "$BACKUP_DIR"
        local backup_path="$BACKUP_DIR/$(basename "$dest")"
        info "Backing up existing $(basename "$dest") to $backup_path"
        mv "$dest" "$backup_path"
    fi

    # Remove existing symlink
    if [[ -L "$dest" ]]; then
        rm "$dest"
    fi

    # Create parent directory if needed
    mkdir -p "$(dirname "$dest")"

    ln -sf "$src" "$dest"
    success "Linked: $(basename "$dest") -> $src"
}

symlink_dotfiles() {
    section "Symlinking Dotfiles"

    # Shell configs
    create_symlink "$DOTFILES_DIR/.zshrc"       "$HOME/.zshrc"
    create_symlink "$DOTFILES_DIR/.zprofile"    "$HOME/.zprofile"
    create_symlink "$DOTFILES_DIR/.zshenv"      "$HOME/.zshenv"

    # Tmux
    create_symlink "$DOTFILES_DIR/tmux.conf"    "$HOME/.tmux.conf"

    # Starship
    create_symlink "$DOTFILES_DIR/starship.toml" "$HOME/.config/starship.toml"

    # Ghostty
    create_symlink "$DOTFILES_DIR/ghostty"      "$HOME/.config/ghostty"

    # Neovim
    create_symlink "$DOTFILES_DIR/nvim"         "$HOME/.config/nvim"

    # AeroSpace (macOS only)
    if [[ "$OS" == "macos" ]]; then
        create_symlink "$DOTFILES_DIR/aerospace.toml" "$HOME/.aerospace.toml"
    fi

    # Check if backup dir was created
    if [[ -d "$BACKUP_DIR" ]]; then
        info "Backups saved to: $BACKUP_DIR"
    fi

    success "All dotfiles symlinked"
}

# =============================================================================
# Set Default Shell
# =============================================================================
set_default_shell() {
    section "Default Shell"

    local zsh_path
    zsh_path="$(which zsh)"

    if [[ "$SHELL" == "$zsh_path" ]]; then
        success "zsh is already the default shell"
        return
    fi

    if confirm "Set zsh as your default shell?"; then
        # Ensure zsh is in /etc/shells
        if ! grep -qF "$zsh_path" /etc/shells 2>/dev/null; then
            echo "$zsh_path" | sudo tee -a /etc/shells > /dev/null
        fi
        chsh -s "$zsh_path"
        success "Default shell set to zsh (takes effect on next login)"
    else
        info "Skipped changing default shell"
    fi
}

# =============================================================================
# Summary
# =============================================================================
print_summary() {
    section "Installation Complete!"

    echo -e "${GREEN}Installed tools:${NC}"
    local tools=(zsh starship ghostty tmux nvim git gh lazygit node python3 rustc go dotnet docker opencode)
    for tool in "${tools[@]}"; do
        if has "$tool"; then
            echo -e "  ${GREEN}+${NC} $tool ($(command -v "$tool"))"
        else
            echo -e "  ${RED}-${NC} $tool (not found)"
        fi
    done

    echo ""
    echo -e "${GREEN}Dotfiles symlinked from:${NC} $DOTFILES_DIR"
    if [[ -d "$BACKUP_DIR" ]]; then
        echo -e "${YELLOW}Backups saved to:${NC} $BACKUP_DIR"
    fi

    echo ""
    echo -e "${BOLD}Next steps:${NC}"
    echo -e "  1. Restart your terminal (or run: ${CYAN}exec zsh${NC})"
    echo -e "  2. Zinit will auto-install zsh plugins on first launch"
    echo -e "  3. Open Neovim - Lazy.nvim will auto-install plugins"
    if [[ "$OS" == "linux" ]] && has docker; then
        echo -e "  4. Log out and back in for Docker group to take effect"
    fi
    echo ""
}

# =============================================================================
# Main
# =============================================================================
main() {
    section "Dotfiles Installer"
    echo -e "This script will install dev tools and symlink dotfiles."
    echo -e "Repository: ${BOLD}$DOTFILES_DIR${NC}"
    echo ""

    detect_os

    # macOS needs Homebrew first
    if [[ "$OS" == "macos" ]]; then
        install_homebrew
    fi

    # Update package manager
    if confirm "Update package manager?"; then
        pkg_update
    fi

    # Interactive install per category
    if confirm "Install Shell & Prompt (zsh, starship)?"; then
        install_shell
    fi

    if confirm "Install Terminal & Multiplexer (ghostty, tmux)?"; then
        install_terminal
    fi

    if confirm "Install Editor (neovim)?"; then
        install_editor
    fi

    if confirm "Install Git Tools (git, gh, lazygit)?"; then
        install_git_tools
    fi

    if confirm "Install Programming Languages (node, python, rust, go, dotnet)?"; then
        install_languages
    fi

    if confirm "Install Docker?"; then
        install_docker
    fi

    if confirm "Install Build Tools (make, cmake, gcc)?"; then
        install_build_tools
    fi

    if confirm "Install Fonts (MesloLGM Nerd Font)?"; then
        install_fonts
    fi

    if [[ "$OS" == "macos" ]]; then
        if confirm "Install AeroSpace (tiling window manager)?"; then
            install_aerospace
        fi
    fi

    if confirm "Install OpenCode (AI CLI tool)?"; then
        install_opencode
    fi

    # Symlinks
    if confirm "Symlink dotfiles to home directory?"; then
        symlink_dotfiles
    fi

    # Default shell
    set_default_shell

    # Summary
    print_summary
}

main "$@"
