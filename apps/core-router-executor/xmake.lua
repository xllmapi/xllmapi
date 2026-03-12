add_repositories("mcpplibs-index https://github.com/mcpplibs/mcpplibs-index.git")
add_requires("mcpplibs-tinyhttps")
add_requires("llmapi")

set_project("core-router-executor")
set_version("0.1.0")
set_languages("c++23")
set_policy("build.c++.modules", true)

target("core-router-executor")
    set_kind("binary")
    add_files("src/main.cpp")
    add_packages("mcpplibs-tinyhttps")
    add_packages("llmapi")
