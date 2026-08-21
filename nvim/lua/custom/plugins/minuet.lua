return {
  'milanglacier/minuet-ai.nvim',
  event = 'InsertEnter',
  dependencies = {
    'nvim-lua/plenary.nvim',
  },
  config = function()
    local model = 'qwen2.5-coder:3b'

    require('minuet').setup {
      provider = 'openai_fim_compatible',
      throttle = 500,
      debounce = 300,
      notify = 'warn',
      provider_options = {
        openai_fim_compatible = {
          api_key = 'TERM',
          name = 'Ollama',
          end_point = 'http://localhost:11434/v1/completions',
          model = model,
          optional = {
            max_tokens = 64,
            top_p = 0.9,
            stop = { '\n' },
          },
        },
      },
      virtualtext = {
        auto_trigger_ft = { '*' },
        keymap = {
          accept = '<C-f>',
          dismiss = '<C-g>',
        },
      },
    }

    vim.api.nvim_create_autocmd('VimLeavePre', {
      desc = 'Stop Ollama autocomplete model when last Neovim exits',
      group = vim.api.nvim_create_augroup('ollama-cleanup', { clear = true }),
      callback = function()
        local handle = io.popen('pgrep -c nvim 2>/dev/null')
        if handle then
          local count = tonumber(handle:read '*a') or 0
          handle:close()
          if count <= 1 then
            vim.fn.system('ollama stop ' .. model)
          end
        end
      end,
    })
  end,
}
