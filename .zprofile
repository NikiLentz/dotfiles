# ~/.zprofile - Zsh login shell configuration
# This file is sourced for login shells (equivalent to .profile for bash)

# ============================================================================
# PATH Configuration
# ============================================================================

# User's private bin
if [ -d "$HOME/bin" ]; then
    PATH="$HOME/bin:$PATH"
fi

# User's local bin
if [ -d "$HOME/.local/bin" ]; then
    PATH="$HOME/.local/bin:$PATH"
fi

# Opencode
if [ -d "$HOME/.opencode/bin" ]; then
    PATH="$HOME/.opencode/bin:$PATH"
fi

export PATH
