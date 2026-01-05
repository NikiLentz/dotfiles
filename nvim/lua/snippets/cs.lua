local ls = require("luasnip")
local s = ls.snippet
local t = ls.text_node
local i = ls.insert_node
local fmt = require("luasnip.extras.fmt").fmt

return {
  -- public required property with get/set
  s("preq", fmt([[public required {} {} {{ get; set; }}]], {
    i(1, "string"),
    i(2, "PropertyName")
  })),

  -- public property with get/set
  s("prop", fmt([[public {} {} {{ get; set; }}]], {
    i(1, "string"),
    i(2, "PropertyName")
  })),

  -- public property with get only
  s("propg", fmt([[public {} {} {{ get; }}]], {
    i(1, "string"),
    i(2, "PropertyName")
  })),

  -- private field
  s("pf", fmt([[private {} {};]], {
    i(1, "string"),
    i(2, "_fieldName")
  })),

  -- public method
  s("pm", fmt([[public {} {}({})
{{
    {}
}}]], {
    i(1, "void"),
    i(2, "MethodName"),
    i(3, ""),
    i(4, "// TODO")
  })),

  -- class
  s("class", fmt([[public class {}
{{
    {}
}}]], {
    i(1, "ClassName"),
    i(2, "")
  })),

  -- interface
  s("interface", fmt([[public interface {}
{{
    {}
}}]], {
    i(1, "IInterfaceName"),
    i(2, "")
  })),

  -- constructor
  s("ctor", fmt([[public {}({})
{{
    {}
}}]], {
    i(1, "ClassName"),
    i(2, ""),
    i(3, "")
  })),

  -- async method
  s("async", fmt([[public async Task<{}> {}({})
{{
    {}
}}]], {
    i(1, "void"),
    i(2, "MethodName"),
    i(3, ""),
    i(4, "// TODO")
  })),

  -- try-catch
  s("try", fmt([[try
{{
    {}
}}
catch ({})
{{
    {}
}}]], {
    i(1, ""),
    i(2, "Exception ex"),
    i(3, "")
  })),
}
